#!/usr/bin/env python3
"""
OpenCV YuNet + SFace Face Detection & Recognition Inference Engine
Smart Attendance System - Milestone F5

Provides:
- Face detection & 5-point landmark localization using YuNet ONNX
- Face alignment and 128-dimensional embedding extraction using SFace ONNX
- Biometric verification via Cosine Similarity and L2 distance
- Single-subject policy enforcement (rejects 0 faces or >1 faces)
"""

import sys
import os
import json
import time
import argparse
import numpy as np

try:
    import cv2
except ImportError:
    sys.stderr.write("ERROR: opencv-python is not installed.\n")
    sys.exit(2)


class FaceEngine:
    def __init__(self, models_dir=None, min_confidence=0.60):
        if models_dir is None:
            # Default to ../../../models relative to this file
            base_dir = os.path.dirname(os.path.abspath(__file__))
            models_dir = os.path.normpath(os.path.join(base_dir, "..", "..", "..", "models"))
        
        self.models_dir = models_dir
        self.yunet_path = os.path.join(models_dir, "face_detection_yunet_2023mar.onnx")
        self.sface_path = os.path.join(models_dir, "face_recognition_sface_2021dec.onnx")
        self.min_confidence = float(min_confidence)

        if not os.path.exists(self.yunet_path):
            raise FileNotFoundError(f"YuNet model file not found at: {self.yunet_path}")
        if not os.path.exists(self.sface_path):
            raise FileNotFoundError(f"SFace model file not found at: {self.sface_path}")

        # Initialize detector with default shape (dynamic resizing handled in detect)
        self.detector = cv2.FaceDetectorYN.create(
            self.yunet_path,
            "",
            (320, 320),
            self.min_confidence,
            0.3, # NMS threshold
            5000 # top_k
        )
        self.recognizer = cv2.FaceRecognizerSF.create(self.sface_path, "")

    def decode_image(self, buffer_bytes=None, file_path=None, base64_str=None):
        """Safely decodes an image from bytes, path, or base64 into a BGR numpy array."""
        try:
            if buffer_bytes is not None and len(buffer_bytes) > 0:
                nparr = np.frombuffer(buffer_bytes, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            elif file_path is not None and os.path.exists(file_path):
                img = cv2.imread(file_path, cv2.IMREAD_COLOR)
            elif base64_str is not None:
                import base64
                if "," in base64_str:
                    base64_str = base64_str.split(",", 1)[1]
                data = base64.b64decode(base64_str)
                nparr = np.frombuffer(data, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            else:
                return None, "NO_IMAGE_DATA_PROVIDED"

            if img is None or img.size == 0 or len(img.shape) != 3:
                return None, "INVALID_IMAGE"

            h, w = img.shape[:2]
            if w < 100 or h < 100 or w > 8192 or h > 8192:
                return None, "IMAGE_DIMENSIONS_OUT_OF_BOUNDS"

            return img, None
        except Exception as e:
            return None, f"DECODE_ERROR: {str(e)}"

    def detect_faces(self, img):
        """Detects faces in image using YuNet with dynamic resolution."""
        h, w = img.shape[:2]
        self.detector.setInputSize((w, h))
        retval, faces = self.detector.detect(img)
        if faces is None or len(faces) == 0:
            return []
        return faces

    def extract_embedding(self, img, face):
        """Aligns face and extracts 128-d L2-normalized feature embedding."""
        aligned = self.recognizer.alignCrop(img, face)
        feature = self.recognizer.feature(aligned)
        # Ensure L2 normalization
        norm = np.linalg.norm(feature)
        if norm > 0:
            feature = feature / norm
        return feature

    def verify_pair(self, ref_img=None, ref_embedding=None, selfie_img=None, threshold=0.40):
        """
        End-to-end verification of reference and selfie.
        Enforces single subject policy, landmark alignment, and cosine similarity threshold.
        """
        start_time = time.perf_counter()
        ref_feat = None
        ref_faces_count = 1

        # 1. Resolve Reference Embedding
        if ref_embedding is not None and len(ref_embedding) == 128:
            ref_feat = np.array(ref_embedding, dtype=np.float32).reshape(1, 128)
            norm = np.linalg.norm(ref_feat)
            if norm > 0:
                ref_feat = ref_feat / norm
        elif ref_img is not None:
            ref_faces = self.detect_faces(ref_img)
            ref_faces_count = len(ref_faces)
            if ref_faces_count == 0:
                return {
                    "success": False,
                    "errorCode": "NO_FACE_DETECTED",
                    "subject": "REFERENCE",
                    "message": "No face detected in reference photo.",
                    "refFaceCount": 0
                }
            if ref_faces_count > 1:
                return {
                    "success": False,
                    "errorCode": "MULTIPLE_FACES_DETECTED",
                    "subject": "REFERENCE",
                    "message": f"Multiple faces ({ref_faces_count}) detected in reference photo. Exactly one required.",
                    "refFaceCount": ref_faces_count
                }
            ref_feat = self.extract_embedding(ref_img, ref_faces[0])
        else:
            return {
                "success": False,
                "errorCode": "REFERENCE_MISSING",
                "message": "Neither reference image nor reference embedding provided."
            }

        # 2. Process Selfie Image
        if selfie_img is None:
            return {
                "success": False,
                "errorCode": "SELFIE_MISSING",
                "message": "No selfie image provided."
            }

        selfie_faces = self.detect_faces(selfie_img)
        selfie_faces_count = len(selfie_faces)

        if selfie_faces_count == 0:
            return {
                "success": False,
                "errorCode": "NO_FACE_DETECTED",
                "subject": "SELFIE",
                "message": "No face detected in selfie image. Ensure proper lighting and face the camera directly.",
                "selfieFaceCount": 0
            }
        if selfie_faces_count > 1:
            return {
                "success": False,
                "errorCode": "MULTIPLE_FACES_DETECTED",
                "subject": "SELFIE",
                "message": f"Multiple faces ({selfie_faces_count}) detected in selfie. Only the student must be in view.",
                "selfieFaceCount": selfie_faces_count
            }

        selfie_face = selfie_faces[0]
        selfie_conf = float(selfie_face[-1])
        if selfie_conf < self.min_confidence:
            return {
                "success": False,
                "errorCode": "LOW_CONFIDENCE",
                "subject": "SELFIE",
                "message": f"Face detection confidence {selfie_conf:.2f} is below required {self.min_confidence:.2f}.",
                "selfieConfidence": selfie_conf
            }

        selfie_feat = self.extract_embedding(selfie_img, selfie_face)

        # 3. Biometric Comparison
        cosine_sim = float(self.recognizer.match(ref_feat, selfie_feat, cv2.FaceRecognizerSF_FR_COSINE))
        l2_dist = float(self.recognizer.match(ref_feat, selfie_feat, cv2.FaceRecognizerSF_FR_NORM_L2))
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        is_match = cosine_sim >= float(threshold)

        return {
            "success": True,
            "matched": is_match,
            "similarity": round(cosine_sim, 4),
            "distance": round(l2_dist, 4),
            "threshold": float(threshold),
            "method": "OPENCV_SFACE_COSINE",
            "refFaceCount": ref_faces_count,
            "selfieFaceCount": selfie_faces_count,
            "selfieConfidence": round(selfie_conf, 4),
            "inferenceTimeMs": round(elapsed_ms, 2),
            "message": "Biometric match verified successfully." if is_match else f"Face mismatch: similarity {cosine_sim:.4f} below threshold {threshold:.4f}."
        }

    def verify_liveness(self, base_img=None, action_img=None, challenge_type="TURN_HEAD_LEFT", ref_img=None, ref_embedding=None, threshold=0.40):
        """
        Multi-factor anti-spoofing and liveness verification.
        Evaluates active challenge-response, anti-static frame difference, identity continuity,
        passive texture/sharpness PAD, and biometric reference match.
        """
        start_time = time.perf_counter()

        if base_img is None or action_img is None:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "MISSING_IMAGE",
                "failureReason": "MISSING_IMAGE",
                "message": "Both base selfie and action selfie images are required for liveness verification."
            }

        # 1. Base Face Detection
        base_faces = self.detect_faces(base_img)
        if len(base_faces) == 0:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "NO_FACE_DETECTED",
                "failureReason": "NO_FACE_DETECTED",
                "subject": "BASE",
                "message": "No face detected in base selfie. Ensure proper lighting and face camera directly."
            }
        if len(base_faces) > 1:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "MULTIPLE_FACES_DETECTED",
                "failureReason": "MULTIPLE_FACES_DETECTED",
                "subject": "BASE",
                "message": f"Multiple faces ({len(base_faces)}) detected in base selfie. Single subject required."
            }

        base_face = base_faces[0]
        base_conf = float(base_face[-1])
        if base_conf < self.min_confidence:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "LOW_CONFIDENCE",
                "failureReason": "POOR_QUALITY",
                "subject": "BASE",
                "message": f"Base face detection confidence {base_conf:.2f} is below minimum {self.min_confidence:.2f}."
            }

        # 2. Action Face Detection
        action_faces = self.detect_faces(action_img)
        if len(action_faces) == 0:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "NO_FACE_DETECTED",
                "failureReason": "NO_FACE_DETECTED",
                "subject": "ACTION",
                "message": "No face detected in challenge response photo."
            }
        if len(action_faces) > 1:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "MULTIPLE_FACES_DETECTED",
                "failureReason": "MULTIPLE_FACES_DETECTED",
                "subject": "ACTION",
                "message": f"Multiple faces ({len(action_faces)}) detected in challenge response photo."
            }

        action_face = action_faces[0]
        action_conf = float(action_face[-1])
        if action_conf < self.min_confidence:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "LOW_CONFIDENCE",
                "failureReason": "POOR_QUALITY",
                "subject": "ACTION",
                "message": f"Action face detection confidence {action_conf:.2f} is below minimum {self.min_confidence:.2f}."
            }

        # 3. Passive PAD (Sharpness / Texture)
        bx, by, bw, bh = [int(v) for v in base_face[:4]]
        ax, ay, aw, ah = [int(v) for v in action_face[:4]]
        base_crop = base_img[max(0, by):min(base_img.shape[0], by+bh), max(0, bx):min(base_img.shape[1], bx+bw)]
        action_crop = action_img[max(0, ay):min(action_img.shape[0], ay+ah), max(0, ax):min(action_img.shape[1], ax+aw)]

        sharpness_base = float(cv2.Laplacian(cv2.cvtColor(base_crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()) if base_crop.size > 0 else 0.0
        sharpness_action = float(cv2.Laplacian(cv2.cvtColor(action_crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()) if action_crop.size > 0 else 0.0
        min_sharpness = min(sharpness_base, sharpness_action)

        if min_sharpness < 20.0:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "POOR_IMAGE_QUALITY",
                "failureReason": "POOR_QUALITY",
                "sharpness": round(min_sharpness, 2),
                "message": "Image sharpness too low. Suspected screen glare or camera blur."
            }

        # 4. Anti-Static Check (Detect printed photo or still replay attack)
        h0, w0 = base_img.shape[:2]
        h1, w1 = action_img.shape[:2]
        resized_action = cv2.resize(action_img, (w0, h0))
        frame_mse = float(np.mean((base_img.astype(float) - resized_action.astype(float)) ** 2))

        lm_base = base_face[4:14]
        lm_action = action_face[4:14]
        lm_delta = float(np.linalg.norm(lm_base - lm_action))

        if frame_mse < 4.0 and lm_delta < 2.0:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "STATIC_IMAGE_DETECTED",
                "failureReason": "STATIC_IMAGE_DETECTED",
                "frameMse": round(frame_mse, 4),
                "landmarkDelta": round(lm_delta, 4),
                "livenessScore": 0.05,
                "message": "Static photo detected: no physical motion detected between capture frames."
            }

        # 5. Extract Feature Embeddings
        base_feat = self.extract_embedding(base_img, base_face)
        action_feat = self.extract_embedding(action_img, action_face)

        # 6. Identity Continuity Check (Base vs Action)
        continuity_sim = float(self.recognizer.match(base_feat, action_feat, cv2.FaceRecognizerSF_FR_COSINE))
        if continuity_sim < 0.70:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "IDENTITY_CONTINUITY_FAILED",
                "failureReason": "IDENTITY_CONTINUITY_FAILED",
                "continuitySimilarity": round(continuity_sim, 4),
                "threshold": 0.70,
                "livenessScore": 0.10,
                "message": f"Identity continuity failed ({continuity_sim:.3f} < 0.70). Person in action frame does not match base selfie."
            }

        # 7. Active Challenge Action Verification
        r_eye_0 = float(base_face[4])
        l_eye_0 = float(base_face[6])
        nose_0 = float(base_face[8])
        yaw_base = ((nose_0 - r_eye_0) - (l_eye_0 - nose_0)) / max(1.0, (l_eye_0 - r_eye_0))

        r_eye_1 = float(action_face[4])
        l_eye_1 = float(action_face[6])
        nose_1 = float(action_face[8])
        yaw_action = ((nose_1 - r_eye_1) - (l_eye_1 - nose_1)) / max(1.0, (l_eye_1 - r_eye_1))

        delta_yaw = yaw_action - yaw_base
        action_verified = False
        action_details = {}

        if challenge_type == 'TURN_HEAD_LEFT':
            if delta_yaw >= 0.06:
                action_verified = True
            action_details = {
                "expected": "TURN_HEAD_LEFT",
                "deltaYaw": round(delta_yaw, 4),
                "threshold": 0.06,
                "verified": action_verified
            }
        elif challenge_type == 'TURN_HEAD_RIGHT':
            if delta_yaw <= -0.06:
                action_verified = True
            action_details = {
                "expected": "TURN_HEAD_RIGHT",
                "deltaYaw": round(delta_yaw, 4),
                "threshold": -0.06,
                "verified": action_verified
            }
        elif challenge_type == 'BLINK':
            gray0 = cv2.cvtColor(base_img, cv2.COLOR_BGR2GRAY)
            gray1 = cv2.cvtColor(resized_action, cv2.COLOR_BGR2GRAY)
            r_pt = base_face[4:6].astype(int)
            l_pt = base_face[6:8].astype(int)
            eye_mses = []
            for pt in [r_pt, l_pt]:
                x, y = pt
                c0 = gray0[max(0, y-12):min(h0, y+12), max(0, x-14):min(w0, x+14)]
                c1 = gray1[max(0, y-12):min(h0, y+12), max(0, x-14):min(w0, x+14)]
                if c0.size > 0 and c1.size > 0 and c0.shape == c1.shape:
                    eye_mses.append(float(np.mean((c0.astype(float) - c1.astype(float))**2)))
            
            avg_eye_mse = float(np.mean(eye_mses)) if len(eye_mses) > 0 else 0.0
            if avg_eye_mse >= 15.0 and abs(delta_yaw) < 0.20:
                action_verified = True
            action_details = {
                "expected": "BLINK",
                "eyeMse": round(avg_eye_mse, 2),
                "threshold": 15.0,
                "deltaYaw": round(delta_yaw, 4),
                "verified": action_verified
            }
        else:
            return {
                "success": False,
                "livenessResult": "INCONCLUSIVE",
                "errorCode": "INVALID_CHALLENGE_TYPE",
                "failureReason": "CHALLENGE_INVALID",
                "message": f"Unsupported challenge action: {challenge_type}"
            }

        if not action_verified:
            return {
                "success": False,
                "livenessResult": "SPOOF",
                "errorCode": "CHALLENGE_MISMATCH",
                "failureReason": "CHALLENGE_MISMATCH",
                "livenessScore": 0.20,
                "actionDetails": action_details,
                "message": f"Challenge action '{challenge_type}' was not performed correctly."
            }

        # 8. Reference Identity Verification
        ref_feat = None
        if ref_embedding is not None and len(ref_embedding) == 128:
            ref_feat = np.array(ref_embedding, dtype=np.float32).reshape(1, 128)
            norm = np.linalg.norm(ref_feat)
            if norm > 0:
                ref_feat = ref_feat / norm
        elif ref_img is not None:
            ref_faces = self.detect_faces(ref_img)
            if len(ref_faces) == 0:
                return {
                    "success": False,
                    "errorCode": "NO_FACE_DETECTED",
                    "subject": "REFERENCE",
                    "message": "No face detected in reference photo."
                }
            if len(ref_faces) > 1:
                return {
                    "success": False,
                    "errorCode": "MULTIPLE_FACES_DETECTED",
                    "subject": "REFERENCE",
                    "message": "Multiple faces detected in reference photo."
                }
            ref_feat = self.extract_embedding(ref_img, ref_faces[0])

        similarity = 0.0
        is_match = True
        if ref_feat is not None:
            similarity = float(self.recognizer.match(ref_feat, base_feat, cv2.FaceRecognizerSF_FR_COSINE))
            is_match = similarity >= float(threshold)

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        liveness_score = round(min(0.99, max(0.80, 0.70 + 0.15 * min(1.0, min_sharpness / 100.0) + 0.15 * continuity_sim)), 4)

        if not is_match:
            return {
                "success": False,
                "livenessResult": "LIVE",
                "livenessScore": liveness_score,
                "matched": False,
                "similarity": round(similarity, 4),
                "threshold": float(threshold),
                "continuitySimilarity": round(continuity_sim, 4),
                "actionDetails": action_details,
                "failureReason": "FACE_MISMATCH",
                "inferenceTimeMs": round(elapsed_ms, 2),
                "message": f"Liveness passed, but face does not match reference photo (similarity {similarity:.4f} < {threshold:.4f})."
            }

        return {
            "success": True,
            "livenessResult": "LIVE",
            "livenessScore": liveness_score,
            "matched": True,
            "similarity": round(similarity, 4) if ref_feat is not None else None,
            "threshold": float(threshold),
            "continuitySimilarity": round(continuity_sim, 4),
            "actionDetails": action_details,
            "sharpness": round(min_sharpness, 2),
            "inferenceTimeMs": round(elapsed_ms, 2),
            "message": "Liveness and biometric identity verified successfully."
        }


def main():
    parser = argparse.ArgumentParser(description="OpenCV YuNet + SFace Face Matching Inference Engine")
    parser.add_argument("command", choices=["ping", "extract", "verify", "liveness"], help="Command to execute")
    parser.add_argument("--models-dir", default=None, help="Directory containing YuNet and SFace ONNX models")
    parser.add_argument("--min-confidence", type=float, default=0.60, help="Minimum face detection confidence")
    parser.add_argument("--threshold", type=float, default=0.40, help="Cosine similarity match threshold")
    parser.add_argument("--input-file", default=None, help="Input JSON file or image file path")

    args = parser.parse_args()

    try:
        engine = FaceEngine(models_dir=args.models_dir, min_confidence=args.min_confidence)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "errorCode": "MODEL_INIT_FAILED",
            "message": str(e)
        }))
        sys.exit(1)

    if args.command == "ping":
        print(json.dumps({
            "success": True,
            "status": "READY",
            "detector": "YuNet-2023mar",
            "recognizer": "SFace-2021dec",
            "embeddingDim": 128,
            "metric": "COSINE_SIMILARITY",
            "modelsDir": engine.models_dir
        }))
        return

    # For extract and verify, read payload from stdin or input file
    payload = {}
    if args.input_file and os.path.exists(args.input_file):
        with open(args.input_file, "r", encoding="utf-8") as f:
            payload = json.load(f)
    elif not sys.stdin.isatty():
        try:
            raw_input = sys.stdin.read()
            if raw_input.strip():
                payload = json.loads(raw_input)
        except Exception as e:
            print(json.dumps({
                "success": False,
                "errorCode": "INVALID_JSON_PAYLOAD",
                "message": f"Failed to parse stdin JSON: {str(e)}"
            }))
            sys.exit(1)

    if args.command == "extract":
        file_path = payload.get("filePath")
        base64_str = payload.get("base64")
        img, err = engine.decode_image(file_path=file_path, base64_str=base64_str)
        if err:
            print(json.dumps({"success": False, "errorCode": err, "message": f"Image decode failure: {err}"}))
            return

        faces = engine.detect_faces(img)
        if len(faces) == 0:
            print(json.dumps({"success": False, "errorCode": "NO_FACE_DETECTED", "faceCount": 0, "message": "No face detected in image."}))
            return
        if len(faces) > 1:
            print(json.dumps({"success": False, "errorCode": "MULTIPLE_FACES_DETECTED", "faceCount": len(faces), "message": f"Multiple faces ({len(faces)}) detected. Single face required."}))
            return

        feat = engine.extract_embedding(img, faces[0])
        box = faces[0][:4].tolist()
        conf = float(faces[0][-1])

        print(json.dumps({
            "success": True,
            "faceCount": 1,
            "confidence": round(conf, 4),
            "box": [round(x, 2) for x in box],
            "embedding": [round(float(x), 6) for x in feat.flatten().tolist()],
            "model": "sface-v1",
            "dim": 128
        }))
        return

    if args.command == "verify":
        ref_path = payload.get("refPath")
        ref_base64 = payload.get("refBase64")
        ref_embedding = payload.get("refEmbedding")

        selfie_path = payload.get("selfiePath")
        selfie_base64 = payload.get("selfieBase64")

        threshold = payload.get("threshold", args.threshold)

        ref_img = None
        if ref_embedding is None:
            ref_img, err = engine.decode_image(file_path=ref_path, base64_str=ref_base64)
            if err:
                print(json.dumps({"success": False, "errorCode": "REFERENCE_" + err, "message": f"Reference photo error: {err}"}))
                return

        selfie_img, err = engine.decode_image(file_path=selfie_path, base64_str=selfie_base64)
        if err:
            print(json.dumps({"success": False, "errorCode": "SELFIE_" + err, "message": f"Selfie photo error: {err}"}))
            return

        result = engine.verify_pair(
            ref_img=ref_img,
            ref_embedding=ref_embedding,
            selfie_img=selfie_img,
            threshold=threshold
        )
        print(json.dumps(result))
        return

    if args.command == "liveness":
        base_path = payload.get("basePath")
        base_base64 = payload.get("baseBase64")
        action_path = payload.get("actionPath")
        action_base64 = payload.get("actionBase64")
        challenge_type = payload.get("challengeType", "TURN_HEAD_LEFT")

        ref_path = payload.get("refPath")
        ref_base64 = payload.get("refBase64")
        ref_embedding = payload.get("refEmbedding")

        threshold = payload.get("threshold", args.threshold)

        base_img, err = engine.decode_image(file_path=base_path, base64_str=base_base64)
        if err:
            print(json.dumps({"success": False, "livenessResult": "SPOOF", "errorCode": "BASE_" + err, "failureReason": "POOR_QUALITY", "message": f"Base image error: {err}"}))
            return

        action_img, err = engine.decode_image(file_path=action_path, base64_str=action_base64)
        if err:
            print(json.dumps({"success": False, "livenessResult": "SPOOF", "errorCode": "ACTION_" + err, "failureReason": "POOR_QUALITY", "message": f"Action image error: {err}"}))
            return

        ref_img = None
        if ref_embedding is None and (ref_path or ref_base64):
            ref_img, err = engine.decode_image(file_path=ref_path, base64_str=ref_base64)
            if err:
                print(json.dumps({"success": False, "livenessResult": "INCONCLUSIVE", "errorCode": "REFERENCE_" + err, "failureReason": "POOR_QUALITY", "message": f"Reference photo error: {err}"}))
                return

        result = engine.verify_liveness(
            base_img=base_img,
            action_img=action_img,
            challenge_type=challenge_type,
            ref_img=ref_img,
            ref_embedding=ref_embedding,
            threshold=threshold
        )
        print(json.dumps(result))
        return



if __name__ == "__main__":
    main()
