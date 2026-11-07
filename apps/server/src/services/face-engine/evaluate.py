#!/usr/bin/env python3
"""
Repeatable Face Matching Engine Evaluation Harness
Smart Attendance System - Milestone F5

Measures:
- Model initialization latency
- Face detection latency (YuNet)
- Landmark alignment and 128-d embedding extraction latency (SFace)
- Pairwise similarity computation latency
- Match vs Mismatch confusion matrix on non-identifying fixtures
"""

import sys
import os
import time
import json
import statistics
import numpy as np

try:
    import cv2
except ImportError:
    sys.stderr.write("ERROR: opencv-python is required for evaluation.\n")
    sys.exit(1)

from infer import FaceEngine


def run_benchmark(fixtures_dir=None, iterations=10):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if fixtures_dir is None:
        fixtures_dir = os.path.normpath(os.path.join(base_dir, "..", "..", "..", "test", "fixtures"))

    print(f"=== Starting Biometric Engine Evaluation (Iterations: {iterations}) ===")
    
    # 1. Measure Model Load Time
    t0 = time.perf_counter()
    engine = FaceEngine()
    load_time_ms = (time.perf_counter() - t0) * 1000.0
    print(f"[1/5] Model Initialization: {load_time_ms:.2f} ms")

    # Fixture paths
    subj_a_ref = os.path.join(fixtures_dir, "face_subject_a_ref.jpg")
    subj_a_selfie = os.path.join(fixtures_dir, "face_subject_a_selfie.jpg")
    subj_b_ref = os.path.join(fixtures_dir, "face_subject_b_ref.jpg")
    subj_b_selfie = os.path.join(fixtures_dir, "face_subject_b_selfie.jpg")
    no_face = os.path.join(fixtures_dir, "face_no_face.jpg")
    multi_face = os.path.join(fixtures_dir, "face_multi_face.jpg")

    img_a_ref, _ = engine.decode_image(file_path=subj_a_ref)
    img_a_selfie, _ = engine.decode_image(file_path=subj_a_selfie)
    img_b_ref, _ = engine.decode_image(file_path=subj_b_ref)
    img_b_selfie, _ = engine.decode_image(file_path=subj_b_selfie)

    # 2. Measure Face Detection Time
    detection_times = []
    for _ in range(iterations):
        t = time.perf_counter()
        engine.detect_faces(img_a_selfie)
        detection_times.append((time.perf_counter() - t) * 1000.0)
    
    avg_det_ms = statistics.mean(detection_times)
    p95_det_ms = np.percentile(detection_times, 95)
    print(f"[2/5] Face Detection (YuNet): Mean={avg_det_ms:.2f} ms, P95={p95_det_ms:.2f} ms")

    # 3. Measure Alignment & Feature Extraction
    faces = engine.detect_faces(img_a_selfie)
    face = faces[0]
    extraction_times = []
    for _ in range(iterations):
        t = time.perf_counter()
        engine.extract_embedding(img_a_selfie, face)
        extraction_times.append((time.perf_counter() - t) * 1000.0)

    avg_ext_ms = statistics.mean(extraction_times)
    p95_ext_ms = np.percentile(extraction_times, 95)
    print(f"[3/5] Embedding Extraction (SFace 128-d): Mean={avg_ext_ms:.2f} ms, P95={p95_ext_ms:.2f} ms")

    # 4. Measure Pairwise Comparison
    feat_a_ref = engine.extract_embedding(img_a_ref, engine.detect_faces(img_a_ref)[0])
    feat_a_selfie = engine.extract_embedding(img_a_selfie, engine.detect_faces(img_a_selfie)[0])
    feat_b_ref = engine.extract_embedding(img_b_ref, engine.detect_faces(img_b_ref)[0])
    feat_b_selfie = engine.extract_embedding(img_b_selfie, engine.detect_faces(img_b_selfie)[0])

    compare_times = []
    for _ in range(iterations):
        t = time.perf_counter()
        engine.recognizer.match(feat_a_ref, feat_a_selfie, cv2.FaceRecognizerSF_FR_COSINE)
        compare_times.append((time.perf_counter() - t) * 1000.0)

    avg_cmp_ms = statistics.mean(compare_times)
    print(f"[4/5] Pairwise Cosine Comparison: Mean={avg_cmp_ms:.4f} ms")

    # 5. Evaluate Verification Outcomes Matrix
    pairs = [
        ("Genuine Match (Subject A)", img_a_ref, None, img_a_selfie, True, 0.40),
        ("Genuine Match (Subject B)", img_b_ref, None, img_b_selfie, True, 0.40),
        ("Impostor Mismatch (A ref vs B selfie)", img_a_ref, None, img_b_selfie, False, 0.40),
        ("Impostor Mismatch (B ref vs A selfie)", img_b_ref, None, img_a_selfie, False, 0.40),
        ("Cached Embedding Match (Subject A)", None, feat_a_ref.flatten().tolist(), img_a_selfie, True, 0.40),
    ]

    print("\n[5/5] Verification Accuracy & Score Matrix:")
    results = []
    for label, r_img, r_emb, s_img, expected_match, thresh in pairs:
        res = engine.verify_pair(ref_img=r_img, ref_embedding=r_emb, selfie_img=s_img, threshold=thresh)
        passed = (res.get("matched") == expected_match)
        print(f"  - {label}: similarity={res['similarity']:.4f}, expected_match={expected_match}, matched={res['matched']}, passed={passed} ({res['inferenceTimeMs']:.1f} ms)")
        results.append({
            "pair": label,
            "similarity": res["similarity"],
            "distance": res["distance"],
            "matched": res["matched"],
            "expected": expected_match,
            "passed": passed,
            "inferenceTimeMs": res["inferenceTimeMs"]
        })

    summary = {
        "modelLoadMs": round(load_time_ms, 2),
        "avgDetectionMs": round(avg_det_ms, 2),
        "avgExtractionMs": round(avg_ext_ms, 2),
        "avgComparisonMs": round(avg_cmp_ms, 4),
        "totalEndToEndMs": round(avg_det_ms + avg_ext_ms + avg_cmp_ms, 2),
        "allPairsPassed": all(r["passed"] for r in results),
        "matrix": results
    }

    print("\nEvaluation Summary:")
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    run_benchmark()
