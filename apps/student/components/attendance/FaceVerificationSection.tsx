import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Colors from '../../constants/Colors';
import {
  AttendanceSession,
  StudentFaceVerificationStatus,
  FaceVerificationResponse,
  LivenessChallengeResponse,
  LivenessVerificationResponse,
  LivenessChallengeType,
  AttendanceFallbackReason,
  AttendanceFallbackRequest,
} from '@smart-attendance/shared';
import { attendanceService } from '../../services/api/attendanceService';
import {
  validateCapturedSelfie,
  resolveImageDimensions,
  SELFIE_LIMITS,
} from '../../utils/imageQuality';

export type FaceUiState =
  | 'BLE_NOT_DETECTED'
  | 'BLE_DETECTED_FACE_REQUIRED'
  | 'NOT_ENROLLED'
  | 'PERMISSION_PROMPT'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_PERMANENTLY_DENIED'
  | 'CAMERA_READY'
  | 'CAPTURING'
  | 'BASE_PREVIEW'
  | 'REQUESTING_CHALLENGE'
  | 'CHALLENGE_CAMERA_READY'
  | 'CHALLENGE_CAPTURING'
  | 'CHALLENGE_PREVIEW'
  | 'IMAGE_QUALITY_REJECTED'
  | 'UPLOADING'
  | 'UPLOAD_FAILED'
  | 'SUCCESS'
  | 'FAILED'
  | 'SERVICE_UNAVAILABLE';

interface CapturedPhoto {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number;
}

interface FaceVerificationSectionProps {
  session: AttendanceSession;
  isBleVerified: boolean;
  onVerificationComplete?: () => void;
}

export default function FaceVerificationSection({
  session,
  isBleVerified,
  onVerificationComplete,
}: FaceVerificationSectionProps) {
  const [faceStatus, setFaceStatus] = useState<StudentFaceVerificationStatus | null>(null);
  const [uiState, setUiState] = useState<FaceUiState>('BLE_NOT_DETECTED');
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [remainingAttempts, setRemainingAttempts] = useState<number>(3);

  // Milestone F6 Two-Frame Liveness Evidence
  const [basePhoto, setBasePhoto] = useState<CapturedPhoto | null>(null);
  const [actionPhoto, setActionPhoto] = useState<CapturedPhoto | null>(null);
  const [currentChallenge, setCurrentChallenge] = useState<LivenessChallengeResponse | null>(null);

  // Milestone F7 Audited Fallback State
  const [fallbackModalVisible, setFallbackModalVisible] = useState<boolean>(false);
  const [fallbackReason, setFallbackReason] = useState<AttendanceFallbackReason>('LIVENESS_FAILED');
  const [fallbackExplanation, setFallbackExplanation] = useState<string>('');
  const [fallbackSubmitting, setFallbackSubmitting] = useState<boolean>(false);
  const [existingFallback, setExistingFallback] = useState<AttendanceFallbackRequest | null>(null);

  const checkExistingFallback = useCallback(async () => {
    if (!session?.id) return;
    try {
      const req = await attendanceService.getFallbackRequest(session.id);
      setExistingFallback(req);
    } catch (e) {
      console.warn('Fallback check notice:', e);
    }
  }, [session?.id]);

  useEffect(() => {
    checkExistingFallback();
  }, [checkExistingFallback]);

  const handleSubmitFallback = async () => {
    if (!session?.id) return;
    setFallbackSubmitting(true);
    try {
      const res = await attendanceService.submitFallbackRequest({
        sessionId: session.id,
        reasonCategory: fallbackReason,
        explanation: fallbackExplanation.trim() || undefined,
      });
      setExistingFallback(res);
      setFallbackModalVisible(false);
      setFallbackExplanation('');
      if (Platform.OS === 'web') {
        window.alert('Fallback request submitted successfully. Your professor has been notified.');
      } else {
        Alert.alert('Request Submitted', 'Fallback request submitted successfully. Your professor has been notified.');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to submit fallback request.';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('Submission Error', msg);
      }
    } finally {
      setFallbackSubmitting(false);
    }
  };

  // Camera permissions hook from expo-camera
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  // Cleanup on unmount or session change
  useEffect(() => {
    return () => {
      setBasePhoto(null);
      setActionPhoto(null);
      setCurrentChallenge(null);
    };
  }, [session?.id]);

  const fetchStatus = useCallback(async () => {
    if (!session?.id) return;
    try {
      const status = await attendanceService.getFaceVerificationStatus(session.id);
      setFaceStatus(status);
      if (status) {
        setRemainingAttempts(status.remainingAttempts);
        if (!isBleVerified && !status.bleDetected) {
          setUiState('BLE_NOT_DETECTED');
        } else if (status.verificationStatus === 'VERIFIED') {
          setUiState('SUCCESS');
        } else if (status.profileStatus === 'NOT_ENROLLED' || status.profileStatus === 'REVOKED') {
          setUiState('NOT_ENROLLED');
        } else if (status.verificationStatus === 'NOT_CONFIGURED') {
          setUiState('SERVICE_UNAVAILABLE');
          setStatusMessage(
            'Selfie pipeline active (Milestone F4). Server face matching engine is deferred to Milestone F5.'
          );
        } else if (isBleVerified || status.bleDetected) {
          // If already in camera/preview flow, don't reset to BLE_DETECTED_FACE_REQUIRED
          setUiState((prev) => {
            const activeCameraStates: FaceUiState[] = [
              'PERMISSION_PROMPT',
              'PERMISSION_DENIED',
              'PERMISSION_PERMANENTLY_DENIED',
              'CAMERA_READY',
              'CAPTURING',
              'BASE_PREVIEW',
              'REQUESTING_CHALLENGE',
              'CHALLENGE_CAMERA_READY',
              'CHALLENGE_CAPTURING',
              'CHALLENGE_PREVIEW',
              'IMAGE_QUALITY_REJECTED',
              'UPLOADING',
              'UPLOAD_FAILED',
            ];
            if (activeCameraStates.includes(prev)) return prev;
            return 'BLE_DETECTED_FACE_REQUIRED';
          });
        }
      } else {
        setUiState(isBleVerified ? 'BLE_DETECTED_FACE_REQUIRED' : 'BLE_NOT_DETECTED');
      }
    } catch {
      setUiState(isBleVerified ? 'BLE_DETECTED_FACE_REQUIRED' : 'BLE_NOT_DETECTED');
    }
  }, [session?.id, isBleVerified]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Synchronize when BLE state transitions to verified
  useEffect(() => {
    if (isBleVerified && uiState === 'BLE_NOT_DETECTED') {
      fetchStatus();
    }
  }, [isBleVerified, uiState, fetchStatus]);

  /**
   * Explains why camera permission is required before triggering system dialog.
   */
  const handleProceedToCamera = () => {
    if (!permission?.granted) {
      setUiState('PERMISSION_PROMPT');
    } else {
      setUiState('CAMERA_READY');
    }
  };

  /**
   * Requests camera permission from OS.
   */
  const handleRequestPermission = async () => {
    try {
      const res = await requestPermission();
      if (res.granted) {
        setUiState('CAMERA_READY');
      } else if (!res.canAskAgain && Platform.OS !== 'web') {
        setUiState('PERMISSION_PERMANENTLY_DENIED');
      } else {
        setUiState('PERMISSION_DENIED');
      }
    } catch (e: any) {
      setUiState('PERMISSION_DENIED');
      setStatusMessage(e?.message || 'Unable to request camera permission.');
    }
  };

  /**
   * Captures photo from front camera (handles both Step 1 Base and Step 2 Action frames).
   */
  const handleCapturePhoto = async () => {
    if (!cameraRef.current) return;
    const isStep1 = uiState === 'CAMERA_READY';
    setUiState(isStep1 ? 'CAPTURING' : 'CHALLENGE_CAPTURING');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });

      if (!photo || !photo.uri) {
        setUiState(isStep1 ? 'CAMERA_READY' : 'CHALLENGE_CAMERA_READY');
        setStatusMessage('Capture was interrupted. Please try again.');
        return;
      }

      // Check dimensions
      let width = photo.width;
      let height = photo.height;
      if (!width || !height) {
        try {
          const dims = await resolveImageDimensions(photo.uri);
          width = dims.width;
          height = dims.height;
        } catch {
          width = 800;
          height = 1000;
        }
      }

      // Local technical image quality checks
      const qualityCheck = validateCapturedSelfie({
        uri: photo.uri,
        width,
        height,
      });

      if (!qualityCheck.isValid) {
        setUiState('IMAGE_QUALITY_REJECTED');
        setStatusMessage(qualityCheck.errorMessage || 'Photo does not meet technical requirements.');
        return;
      }

      const captured = { uri: photo.uri, width, height };

      if (isStep1) {
        // Step 1 completed: store base photo, request unpredictable challenge for Step 2
        setBasePhoto(captured);
        setUiState('REQUESTING_CHALLENGE');
        setStatusMessage('Requesting unpredictable liveness challenge from server...');

        try {
          const challenge = await attendanceService.requestLivenessChallenge(session.id);
          setCurrentChallenge(challenge);
          setUiState('CHALLENGE_CAMERA_READY');
          setStatusMessage(challenge.promptInstruction);
        } catch (challengeErr: any) {
          // If challenge request fails, fall back to base preview
          setUiState('BASE_PREVIEW');
          setStatusMessage(challengeErr?.message || 'Failed to obtain challenge. You may retry or submit single selfie.');
        }
      } else {
        // Step 2 completed: store action photo and proceed to confirmation preview
        setActionPhoto(captured);
        setUiState('CHALLENGE_PREVIEW');
        setStatusMessage('');
      }
    } catch (err: any) {
      setUiState(isStep1 ? 'CAMERA_READY' : 'CHALLENGE_CAMERA_READY');
      setStatusMessage(err?.message || 'Failed to capture photo. Please retry.');
    }
  };

  /**
   * Resets capture state and starts over.
   */
  const handleRetakePhoto = () => {
    setBasePhoto(null);
    setActionPhoto(null);
    setCurrentChallenge(null);
    setStatusMessage('');
    setUiState('CAMERA_READY');
  };

  /**
   * Submits both frames to the backend multi-factor liveness endpoint.
   */
  const handleSubmitLiveness = async () => {
    if (!basePhoto?.uri || !session?.id) return;

    setLoading(true);
    setUiState('UPLOADING');
    setStatusMessage('Verifying liveness challenge, anti-spoofing, and reference photo match...');

    try {
      if (currentChallenge?.challengeId && actionPhoto?.uri) {
        const res: LivenessVerificationResponse = await attendanceService.verifyLiveness({
          sessionId: session.id,
          challengeId: currentChallenge.challengeId,
          basePhoto: {
            uri: basePhoto.uri,
            name: 'base_selfie.jpg',
            type: 'image/jpeg',
          },
          actionPhoto: {
            uri: actionPhoto.uri,
            name: 'action_selfie.jpg',
            type: 'image/jpeg',
          },
        });

        setRemainingAttempts(res.remainingAttempts);

        if (res.success && res.status === 'VERIFIED') {
          setUiState('SUCCESS');
          setStatusMessage('Liveness and biometric identity confirmed. Attendance marked PRESENT.');
          onVerificationComplete?.();
        } else if (res.status === 'NOT_CONFIGURED') {
          setUiState('SERVICE_UNAVAILABLE');
          setStatusMessage(
            res.message ||
              'Liveness submission received. Face matching engine is not configured on this server.'
          );
        } else {
          setUiState('FAILED');
          setStatusMessage(res.message || 'Liveness or face verification failed. Please retry.');
        }
      } else {
        // Fallback to legacy single-selfie verification if no challenge
        const res = await attendanceService.verifyFace(session.id, {
          uri: basePhoto.uri,
          name: 'selfie.jpg',
          type: 'image/jpeg',
        });

        setRemainingAttempts(res.remainingAttempts);

        if (res.success && res.status === 'VERIFIED') {
          setUiState('SUCCESS');
          setStatusMessage('Biometric identity confirmed. Attendance marked PRESENT.');
          onVerificationComplete?.();
        } else if (res.status === 'NOT_CONFIGURED') {
          setUiState('SERVICE_UNAVAILABLE');
          setStatusMessage(res.message || 'Server face matching engine is not configured.');
        } else {
          setUiState('FAILED');
          setStatusMessage(res.message || 'Face verification failed.');
        }
      }
    } catch (err: any) {
      setUiState('UPLOAD_FAILED');
      setStatusMessage(err?.message || 'Failed to submit verification request. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    switch (uiState) {
      case 'BLE_NOT_DETECTED':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleDim}>
              <Text style={styles.iconTextDim}>📷</Text>
            </View>
            <Text style={styles.title}>Step 2: Face Verification</Text>
            <Text style={styles.subtitle}>
              Classroom proximity required. Broadcast your BLE attendance beacon above to unlock selfie capture.
            </Text>
            <View style={styles.statusPillWaiting}>
              <Text style={styles.statusPillTextWaiting}>Waiting for BLE Proximity</Text>
            </View>
          </View>
        );

      case 'BLE_DETECTED_FACE_REQUIRED':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleActive}>
              <Text style={styles.iconTextActive}>🤳</Text>
            </View>
            <Text style={styles.title}>Face Verification Required</Text>
            <Text style={styles.subtitle}>
              Proximity confirmed! Please capture a live selfie to verify your attendance against your official college photo.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleProceedToCamera}>
              <Text style={styles.primaryButtonText}>Open Camera & Capture</Text>
            </TouchableOpacity>
          </View>
        );

      case 'PERMISSION_PROMPT':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleActive}>
              <Text style={styles.iconTextActive}>📸</Text>
            </View>
            <Text style={styles.title}>Camera Access Required</Text>
            <Text style={styles.subtitle}>
              To prevent proxy attendance, we need access to your front camera to capture a live selfie. Your photo is securely transmitted directly to college servers.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleRequestPermission}>
              <Text style={styles.primaryButtonText}>Grant Camera Permission</Text>
            </TouchableOpacity>
          </View>
        );

      case 'PERMISSION_DENIED':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleWarning}>
              <Text style={styles.iconTextWarning}>⚠️</Text>
            </View>
            <Text style={styles.title}>Camera Permission Denied</Text>
            <Text style={styles.subtitle}>
              Camera permission is required to capture your attendance selfie. Please grant permission to continue.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleRequestPermission}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fallbackTriggerButton}
              onPress={() => {
                setFallbackReason('CAMERA_PERMISSION_DENIED');
                setFallbackModalVisible(true);
              }}
            >
              <Text style={styles.fallbackTriggerText}>Camera Denied • Request Fallback</Text>
            </TouchableOpacity>
          </View>
        );

      case 'PERMISSION_PERMANENTLY_DENIED':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleError}>
              <Text style={styles.iconTextError}>🚫</Text>
            </View>
            <Text style={styles.title}>Camera Blocked in Settings</Text>
            <Text style={styles.subtitle}>
              Camera access was denied permanently. Please open your device Settings and grant Camera permission for Smart Attendance.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => Linking.openSettings()}>
              <Text style={styles.primaryButtonText}>Open Device Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fallbackTriggerButton}
              onPress={() => {
                setFallbackReason('CAMERA_PERMISSION_DENIED');
                setFallbackModalVisible(true);
              }}
            >
              <Text style={styles.fallbackTriggerText}>Camera Blocked • Request Fallback</Text>
            </TouchableOpacity>
          </View>
        );

      case 'CAMERA_READY':
      case 'CAPTURING':
        return (
          <View style={styles.cameraContainer}>
            <View style={styles.stepBanner}>
              <Text style={styles.stepBannerText}>STEP 1 OF 2: BASE SELFIE</Text>
            </View>
            <View style={styles.viewfinderWrapper}>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="front"
              />
              <View style={styles.faceGuideOverlay}>
                <View style={styles.ovalGuide} />
                <Text style={styles.guideInstruction}>Fit face within oval • Look straight</Text>
              </View>
            </View>

            {statusMessage ? (
              <Text style={styles.errorText}>{statusMessage}</Text>
            ) : null}

            <View style={styles.captureActions}>
              <TouchableOpacity
                style={[styles.captureButton, uiState === 'CAPTURING' && styles.buttonDisabled]}
                disabled={uiState === 'CAPTURING'}
                onPress={handleCapturePhoto}
              >
                {uiState === 'CAPTURING' ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <View style={styles.captureButtonInner} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'REQUESTING_CHALLENGE':
        return (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />
            <Text style={styles.title}>Preparing Liveness Challenge...</Text>
            <Text style={styles.subtitle}>
              Step 1 captured. Requesting unpredictable active challenge from server...
            </Text>
          </View>
        );

      case 'CHALLENGE_CAMERA_READY':
      case 'CHALLENGE_CAPTURING':
        const challengeIcon =
          currentChallenge?.challengeType === 'TURN_HEAD_LEFT'
            ? '⬅️'
            : currentChallenge?.challengeType === 'TURN_HEAD_RIGHT'
            ? '➡️'
            : '👁️';

        return (
          <View style={styles.cameraContainer}>
            <View style={styles.challengeBanner}>
              <Text style={styles.challengeBannerTitle}>STEP 2 OF 2: ACTIVE CHALLENGE</Text>
              <Text style={styles.challengeBannerAction}>
                {challengeIcon} {currentChallenge?.promptInstruction || 'Perform the requested action'}
              </Text>
            </View>

            <View style={styles.viewfinderWrapper}>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="front"
              />
              <View style={styles.faceGuideOverlay}>
                <View style={[styles.ovalGuide, styles.ovalGuideChallenge]} />
                <Text style={styles.guideInstruction}>
                  {currentChallenge?.challengeType === 'TURN_HEAD_LEFT'
                    ? 'Turn head slightly LEFT'
                    : currentChallenge?.challengeType === 'TURN_HEAD_RIGHT'
                    ? 'Turn head slightly RIGHT'
                    : 'Blink your eyes now'}
                </Text>
              </View>
            </View>

            {statusMessage ? (
              <Text style={styles.infoText}>{statusMessage}</Text>
            ) : null}

            <View style={styles.captureActions}>
              <TouchableOpacity
                style={[styles.captureButton, uiState === 'CHALLENGE_CAPTURING' && styles.buttonDisabled]}
                disabled={uiState === 'CHALLENGE_CAPTURING'}
                onPress={handleCapturePhoto}
              >
                {uiState === 'CHALLENGE_CAPTURING' ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <View style={[styles.captureButtonInner, styles.captureButtonAction]} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'CHALLENGE_PREVIEW':
      case 'BASE_PREVIEW':
        return (
          <View style={styles.previewContainer}>
            <Text style={styles.previewTitle}>Review Liveness Verification</Text>
            <View style={styles.multiPreviewRow}>
              {basePhoto?.uri && (
                <View style={styles.thumbnailWrapper}>
                  <Text style={styles.thumbnailLabel}>Frame 1: Frontal</Text>
                  <Image source={{ uri: basePhoto.uri }} style={styles.thumbnailImage} resizeMode="cover" />
                </View>
              )}
              {actionPhoto?.uri && (
                <View style={styles.thumbnailWrapper}>
                  <Text style={styles.thumbnailLabel}>
                    Frame 2: {currentChallenge?.challengeType === 'TURN_HEAD_LEFT' ? 'Turn Left' : currentChallenge?.challengeType === 'TURN_HEAD_RIGHT' ? 'Turn Right' : 'Blink'}
                  </Text>
                  <Image source={{ uri: actionPhoto.uri }} style={styles.thumbnailImage} resizeMode="cover" />
                </View>
              )}
            </View>

            <View style={styles.challengeSummaryBadge}>
              <Text style={styles.challengeSummaryText}>
                Active Challenge: {currentChallenge?.challengeType || 'COMPLETED'}
              </Text>
            </View>

            <Text style={styles.subtitle}>
              Both frames will be compared for motion, identity continuity, and verified against your official college photo.
            </Text>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.secondaryButton, loading && styles.buttonDisabled]}
                disabled={loading}
                onPress={handleRetakePhoto}
              >
                <Text style={styles.secondaryButtonText}>Retake Both</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButtonSmall, loading && styles.buttonDisabled]}
                disabled={loading}
                onPress={handleSubmitLiveness}
              >
                <Text style={styles.primaryButtonText}>Verify & Mark Present</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'IMAGE_QUALITY_REJECTED':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleWarning}>
              <Text style={styles.iconTextWarning}>⚠️</Text>
            </View>
            <Text style={styles.title}>Selfie Quality Rejected</Text>
            <Text style={styles.subtitle}>
              {statusMessage ||
                `The captured image is below the minimum required resolution (${SELFIE_LIMITS.MIN_DIMENSION_PX}x${SELFIE_LIMITS.MIN_DIMENSION_PX} px) or file size.`}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleRetakePhoto}>
              <Text style={styles.primaryButtonText}>Retake Selfie</Text>
            </TouchableOpacity>
          </View>
        );

      case 'UPLOADING':
        return (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />
            <Text style={styles.title}>Submitting Selfie...</Text>
            <Text style={styles.subtitle}>
              {statusMessage || 'Securely uploading selfie to attendance server...'}
            </Text>
          </View>
        );

      case 'UPLOAD_FAILED':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleError}>
              <Text style={styles.iconTextError}>✕</Text>
            </View>
            <Text style={styles.titleError}>Upload Failed</Text>
            <Text style={styles.subtitle}>
              {statusMessage || 'Unable to deliver selfie to the server. Please check your network connection.'}
            </Text>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleRetakePhoto}>
                <Text style={styles.secondaryButtonText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButtonSmall} onPress={handleSubmitLiveness}>
                <Text style={styles.primaryButtonText}>Retry Upload</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'NOT_ENROLLED':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleWarning}>
              <Text style={styles.iconTextWarning}>⚠️</Text>
            </View>
            <Text style={styles.title}>Reference Photo Not Enrolled</Text>
            <Text style={styles.subtitle}>
              Your HOD has not yet approved or enrolled your reference photo in the Admin portal. Please contact your department administrator.
            </Text>
            <View style={styles.statusPillWarning}>
              <Text style={styles.statusPillTextWarning}>Enrollment Pending</Text>
            </View>
          </View>
        );

      case 'SERVICE_UNAVAILABLE':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleInfo}>
              <Text style={styles.iconTextInfo}>ℹ️</Text>
            </View>
            <Text style={styles.title}>Selfie Received by Server</Text>
            <Text style={styles.subtitle}>
              {statusMessage ||
                'Selfie submission pipeline active (Milestone F4). Real-time biometric face matching engine is deferred to Milestone F5.'}
            </Text>
            <View style={styles.statusPillInfo}>
              <Text style={styles.statusPillTextInfo}>Milestone F4 Pipeline Verified</Text>
            </View>
          </View>
        );

      case 'SUCCESS':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleSuccess}>
              <Text style={styles.iconTextSuccess}>✓</Text>
            </View>
            <Text style={styles.titleSuccess}>Face Verification Successful</Text>
            <Text style={styles.subtitle}>
              Identity verified against approved reference photo. Attendance marked PRESENT.
            </Text>
            <View style={styles.statusPillSuccess}>
              <Text style={styles.statusPillTextSuccess}>Biometric Match Confirmed</Text>
            </View>
          </View>
        );

      case 'FAILED':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.iconCircleError}>
              <Text style={styles.iconTextError}>✕</Text>
            </View>
            <Text style={styles.titleError}>Verification Failed</Text>
            <Text style={styles.subtitle}>
              {statusMessage || 'Face does not match approved reference photo.'}
            </Text>
            <Text style={styles.attemptInfo}>Remaining Attempts: {remainingAttempts} of 3</Text>
            {remainingAttempts > 0 ? (
              <TouchableOpacity style={styles.primaryButton} onPress={handleProceedToCamera}>
                <Text style={styles.primaryButtonText}>Retry Verification</Text>
              </TouchableOpacity>
            ) : (
              <>
                <View style={styles.statusPillError}>
                  <Text style={styles.statusPillTextError}>Attempts Exceeded • See Professor</Text>
                </View>
                <TouchableOpacity
                  style={styles.fallbackTriggerButton}
                  onPress={() => {
                    setFallbackReason('LIVENESS_FAILED');
                    setFallbackModalVisible(true);
                  }}
                >
                  <Text style={styles.fallbackTriggerText}>Report Issue / Request Fallback</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );
    }
  };

  return (
    <View style={styles.card}>
      
      {existingFallback && (
        <View style={[
          styles.fallbackBannerBox,
          existingFallback.status === 'APPROVED' ? styles.fallbackBannerApproved :
          existingFallback.status === 'REJECTED' ? styles.fallbackBannerRejected :
          styles.fallbackBannerPending
        ]}>
          <Text style={styles.fallbackBannerTitle}>
            {existingFallback.status === 'APPROVED' ? '✓ Fallback Attendance Approved' :
             existingFallback.status === 'REJECTED' ? '✕ Fallback Request Rejected' :
             '⏳ Fallback Request Pending Professor Review'}
          </Text>
          <Text style={styles.fallbackBannerReason}>
            Reason: {existingFallback.reasonCategory.replace(/_/g, ' ')}
          </Text>
          {existingFallback.explanation ? (
            <Text style={styles.fallbackBannerExplanation}>"{existingFallback.explanation}"</Text>
          ) : null}
          {existingFallback.reviewNotes ? (
            <Text style={styles.fallbackBannerNotes}>Notes: {existingFallback.reviewNotes}</Text>
          ) : null}
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.sectionHeader}>FACIAL VERIFICATION (TWO-FACTOR)</Text>
      </View>

      {renderContent()}


      {/* Milestone F7 Fallback Request Modal */}
      <Modal
        visible={fallbackModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFallbackModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Request Attendance Fallback</Text>
            <Text style={styles.modalSubtitle}>
              Report an issue preventing automated face verification. Your professor will audit and verify your presence.
            </Text>

            <Text style={styles.modalFieldLabel}>Issue Category</Text>
            <View style={styles.categoryPills}>
              {[
                { label: 'Camera Permission Denied', value: 'CAMERA_PERMISSION_DENIED' },
                { label: 'Camera Unavailable / Failed', value: 'CAMERA_UNAVAILABLE' },
                { label: 'Liveness Challenge Failed', value: 'LIVENESS_FAILED' },
                { label: 'Challenge Expired', value: 'LIVENESS_EXPIRED' },
                { label: 'Face Mismatch', value: 'FACE_MISMATCH' },
                { label: 'BLE Unavailable', value: 'BLE_UNAVAILABLE' },
                { label: 'Other Technical Issue', value: 'TECHNICAL_ISSUE' },
              ].map((cat) => (
                <TouchableOpacity
                  key={cat.value}
                  style={[
                    styles.categoryPill,
                    fallbackReason === cat.value && styles.categoryPillActive,
                  ]}
                  onPress={() => setFallbackReason(cat.value as AttendanceFallbackReason)}
                >
                  <Text
                    style={[
                      styles.categoryPillText,
                      fallbackReason === cat.value && styles.categoryPillTextActive,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.modalFieldLabel}>Explanation (Optional, max 500 chars)</Text>
            <TextInput
              style={styles.modalInput}
              value={fallbackExplanation}
              onChangeText={setFallbackExplanation}
              placeholder="e.g. Camera lens scratched / low lighting in room"
              placeholderTextColor="#8B949E"
              multiline
              numberOfLines={3}
              maxLength={500}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setFallbackModalVisible(false)}
                disabled={fallbackSubmitting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitButton, fallbackSubmitting && styles.buttonDisabled]}
                onPress={handleSubmitFallback}
                disabled={fallbackSubmitting}
              >
                {fallbackSubmitting ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={styles.modalSubmitText}>Submit Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#161B22',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363D',
    marginTop: 16,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
    paddingBottom: 8,
    marginBottom: 12,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8B949E',
    letterSpacing: 1,
  },
  stateContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  cameraContainer: {
    alignItems: 'center',
    width: '100%',
  },
  viewfinderWrapper: {
    width: '100%',
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  faceGuideOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  ovalGuide: {
    width: 170,
    height: 220,
    borderRadius: 85,
    borderWidth: 2,
    borderColor: 'rgba(0, 230, 118, 0.75)',
    borderStyle: 'dashed',
  },
  guideInstruction: {
    color: '#E6EDF3',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  captureActions: {
    marginTop: 14,
    alignItems: 'center',
  },
  captureButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E6EDF3',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: Colors.primary,
  },
  captureButtonInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
  },
  previewContainer: {
    alignItems: 'center',
    width: '100%',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E6EDF3',
    marginBottom: 10,
  },
  previewImageWrapper: {
    width: 200,
    height: 250,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: '#30363D',
    marginBottom: 10,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  metaBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  metaBadgeText: {
    color: '#00E676',
    fontSize: 10,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    width: '100%',
    justifyContent: 'center',
  },
  primaryButtonSmall: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#21262D',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  secondaryButtonText: {
    color: '#C9D1D9',
    fontSize: 14,
    fontWeight: '600',
  },
  iconCircleDim: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#21262D',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconTextDim: {
    fontSize: 22,
    opacity: 0.5,
  },
  iconCircleActive: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconTextActive: {
    fontSize: 22,
  },
  iconCircleWarning: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 215, 64, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconTextWarning: {
    fontSize: 22,
  },
  iconCircleError: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 82, 82, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconTextError: {
    fontSize: 22,
    color: Colors.error,
    fontWeight: '700',
  },
  iconCircleSuccess: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 230, 118, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconTextSuccess: {
    fontSize: 24,
    color: Colors.success,
    fontWeight: '700',
  },
  iconCircleInfo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(56, 139, 253, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconTextInfo: {
    fontSize: 22,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E6EDF3',
    marginBottom: 6,
    textAlign: 'center',
  },
  titleSuccess: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.success,
    marginBottom: 6,
    textAlign: 'center',
  },
  titleError: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.error,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#8B949E',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  attemptInfo: {
    fontSize: 12,
    color: '#FFD740',
    fontWeight: '600',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  spinner: {
    marginVertical: 12,
  },
  statusPillWaiting: {
    backgroundColor: '#21262D',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363D',
  },
  statusPillTextWaiting: {
    fontSize: 11,
    color: '#8B949E',
    fontWeight: '600',
  },
  statusPillSuccess: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.success,
  },
  statusPillTextSuccess: {
    fontSize: 11,
    color: Colors.success,
    fontWeight: '700',
  },
  statusPillWarning: {
    backgroundColor: 'rgba(255, 215, 64, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFD740',
  },
  statusPillTextWarning: {
    fontSize: 11,
    color: '#FFD740',
    fontWeight: '600',
  },
  statusPillError: {
    backgroundColor: 'rgba(255, 82, 82, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  statusPillTextError: {
    fontSize: 11,
    color: Colors.error,
    fontWeight: '700',
  },
  statusPillInfo: {
    backgroundColor: 'rgba(56, 139, 253, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#388BFD',
  },
  statusPillTextInfo: {
    fontSize: 11,
    color: '#58A6FF',
    fontWeight: '600',
  },
  errorText: {
    color: Colors.error,
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 6,
  },
  infoText: {
    color: '#58A6FF',
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 6,
    fontWeight: '600',
  },
  stepBanner: {
    backgroundColor: '#161B22',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#30363D',
    alignItems: 'center',
  },
  stepBannerText: {
    color: '#8B949E',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  challengeBanner: {
    backgroundColor: 'rgba(56, 139, 253, 0.15)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#388BFD',
    alignItems: 'center',
  },
  challengeBannerTitle: {
    color: '#58A6FF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  challengeBannerAction: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  ovalGuideChallenge: {
    borderColor: '#388BFD',
  },
  captureButtonAction: {
    backgroundColor: '#388BFD',
  },
  multiPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  thumbnailWrapper: {
    alignItems: 'center',
  },
  thumbnailImage: {
    width: 120,
    height: 150,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363D',
  },
  thumbnailLabel: {
    fontSize: 10,
    color: '#8B949E',
    fontWeight: '600',
    marginBottom: 4,
  },
  challengeSummaryBadge: {
    backgroundColor: '#161B22',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363D',
    alignSelf: 'center',
    marginBottom: 10,
  },
  challengeSummaryText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
  },
  devControls: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#21262D',
  },
  devTitle: {
    fontSize: 9,
    color: '#484F58',
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  devPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  devPill: {
    backgroundColor: '#0D1117',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#21262D',
  },
  devPillActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
  },
  devPillText: {
    fontSize: 9,
    color: '#8B949E',
  },
  devPillTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },

  fallbackBannerBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
  },
  fallbackBannerPending: {
    backgroundColor: 'rgba(255, 145, 0, 0.1)',
    borderColor: '#FF9100',
  },
  fallbackBannerApproved: {
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
    borderColor: '#00E676',
  },
  fallbackBannerRejected: {
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    borderColor: '#FF5252',
  },
  fallbackBannerTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  fallbackBannerReason: {
    color: '#8B949E',
    fontSize: 12,
  },
  fallbackBannerExplanation: {
    color: '#C9D1D9',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  fallbackBannerNotes: {
    color: Colors.primary,
    fontSize: 12,
    marginTop: 4,
  },
  fallbackTriggerButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FF9100',
    backgroundColor: 'rgba(255, 145, 0, 0.1)',
    alignItems: 'center',
  },
  fallbackTriggerText: {
    color: '#FF9100',
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: '#30363D',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalSubtitle: {
    color: '#8B949E',
    fontSize: 12,
    marginBottom: 16,
    lineHeight: 17,
  },
  modalFieldLabel: {
    color: '#C9D1D9',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  categoryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  categoryPill: {
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  categoryPillActive: {
    borderColor: '#FF9100',
    backgroundColor: 'rgba(255, 145, 0, 0.15)',
  },
  categoryPillText: {
    color: '#8B949E',
    fontSize: 11,
    fontWeight: '500',
  },
  categoryPillTextActive: {
    color: '#FF9100',
    fontWeight: '700',
  },
  modalInput: {
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
    color: '#FFFFFF',
    padding: 10,
    fontSize: 13,
    marginBottom: 16,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelButton: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363D',
  },
  modalCancelText: {
    color: '#8B949E',
    fontSize: 13,
    fontWeight: '600',
  },
  modalSubmitButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSubmitText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },

});
