// Webcam acquisition: enumerate devices, open a stream, map failures to readable
// messages, and release tracks reliably.

export interface VideoSource {
  kind: 'camera' | 'synthetic';
  label: string;
  video: HTMLVideoElement;
  stream: MediaStream;
  stop(): void;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
  isVirtual: boolean;
}

/** Virtual cameras (OBS, etc.) as *input* would feed our own output back into itself. */
const VIRTUAL_CAMERA_RE = /obs|virtual|snap camera|xsplit|manycam|droidcam virtual|fractalcam/i;

export function isVirtualCameraLabel(label: string): boolean {
  return VIRTUAL_CAMERA_RE.test(label);
}

export class CameraError extends Error {
  constructor(
    public code: 'insecure' | 'unsupported' | 'denied' | 'notfound' | 'busy' | 'overconstrained' | 'aborted' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export function describeCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = (err as { name?: string })?.name ?? '';
  const msg = (err as { message?: string })?.message ?? String(err);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new CameraError(
        'denied',
        'Camera access was blocked. Click the camera icon at the right of the address bar, choose "Allow", then press Retry. ' +
          'Also check Windows Settings → Privacy & security → Camera → "Let desktop apps access your camera".',
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('notfound', 'No camera was found. Plug in a webcam, or use the synthetic test pattern.');
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError(
        'busy',
        'The camera exists but could not be started. Another app (Zoom, Teams, OBS, the Windows Camera app) may be using it exclusively — close it and press Retry.',
      );
    case 'OverconstrainedError':
      return new CameraError('overconstrained', 'The selected camera does not support the requested mode.');
    case 'AbortError':
      return new CameraError('aborted', `Camera start was interrupted (${msg}). Press Retry.`);
    case 'SecurityError':
      return new CameraError('insecure', 'Camera access requires a secure context. Open the app at http://localhost:5173.');
    default:
      return new CameraError('unknown', `Camera error: ${name ? name + ': ' : ''}${msg}`);
  }
}

export function cameraSupport(): CameraError | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return new CameraError(
      'insecure',
      `This page is not a secure context (${location.origin}), so the browser hides the camera API. ` +
        'Open it via http://localhost:5173 instead of a WSL IP address.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return new CameraError('unsupported', 'This browser does not support camera capture. Use current Chrome or Edge.');
  }
  return null;
}

export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      isVirtual: isVirtualCameraLabel(d.label),
    }));
}

export async function cameraPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

async function attachVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CameraError('aborted', 'Timed out waiting for video frames.')), 10000);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  await video.play();
  return video;
}

function makeSource(kind: VideoSource['kind'], label: string, stream: MediaStream, video: HTMLVideoElement, extraStop?: () => void): VideoSource {
  let stopped = false;
  return {
    kind,
    label,
    video,
    stream,
    stop() {
      if (stopped) return;
      stopped = true;
      extraStop?.();
      stopStream(stream);
      video.pause();
      video.srcObject = null;
    },
  };
}

/**
 * Open a physical camera. deviceId '' picks the best default, skipping virtual
 * cameras (OBS Virtual Camera would create a feedback loop).
 */
export async function openCamera(deviceId: string): Promise<VideoSource> {
  const unsupported = cameraSupport();
  if (unsupported) throw unsupported;

  let chosen = deviceId;
  if (!chosen) {
    // Labels are only visible after permission was granted once; if so, avoid virtual cams.
    const cams = await listCameras().catch(() => []);
    const physical = cams.find((c) => !c.isVirtual && c.deviceId);
    if (physical) chosen = physical.deviceId;
  }

  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 60 },
    ...(chosen ? { deviceId: { exact: chosen } } : {}),
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    const e = describeCameraError(err);
    if (e.code === 'overconstrained' || (e.code === 'notfound' && chosen)) {
      // Saved device vanished or cannot do 720p: fall back to anything that works.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        throw describeCameraError(err2);
      }
    } else {
      throw e;
    }
  }

  try {
    const el = await attachVideo(stream);
    const label = stream.getVideoTracks()[0]?.label || 'Camera';
    return makeSource('camera', label, stream, el);
  } catch (err) {
    stopStream(stream);
    throw describeCameraError(err);
  }
}

export async function wrapStream(kind: VideoSource['kind'], label: string, stream: MediaStream, onStop?: () => void) {
  const el = await attachVideo(stream);
  return makeSource(kind, label, stream, el, onStop);
}
