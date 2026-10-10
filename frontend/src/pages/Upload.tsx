import { useRef, useState, type DragEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { FileVideo, Upload as UploadIcon, X } from 'lucide-react';
import { PageHeader } from '../components/layout/Layouts';
import { Button, ButtonLink } from '../components/ui/Button';
import { FieldError, SelectField } from '../components/ui/Form';
import { ErrorState, LimitState, LoadingAnnouncer, LockedState, Skeleton } from '../components/ui/States';
import { capFor, useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { FREE_SCAN_MAX_SECONDS } from '../data/types';
import { fileSize, hours, minutes } from '../lib/format';
import { cn, useDocumentTitle } from '../lib/hooks';

const ACCEPT = ['video/mp4', 'video/quicktime'];
const MAX_BYTES = 2e9;

interface Picked {
  name: string;
  size: number;
  duration: number;
}

function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : 38 * 60);
    v.onerror = () => done(38 * 60);
    v.src = url;
  });
}

export default function UploadPage() {
  useDocumentTitle('Upload clip');
  const demo = useDemo();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const screen = useScreenState(['loading', 'error', 'locked', 'limit']);
  const free = !demo.isActive;
  const [cameraId, setCameraId] = useState(params.get('camera') ?? demo.cameras[1]?.id ?? demo.cameras[0]?.id ?? '');
  const [file, setFile] = useState<Picked | null>(null);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const camera = demo.cameras.find((c) => c.id === cameraId);
  const left = camera ? Math.max(0, capFor(camera) - camera.usedSecondsToday) : 0;

  const pick = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (!ACCEPT.includes(f.type) && !/\.(mp4|mov)$/i.test(f.name)) {
      setFile(null);
      return setError(`${f.name} isn't a video Nicked can read. Export it from your recorder as MP4 or MOV.`);
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      return setError(`That file is ${fileSize(f.size)}. The limit is 2 GB. Split it into shorter clips.`);
    }
    const duration = await readDuration(f);
    if (free && duration > FREE_SCAN_MAX_SECONDS) {
      setFile(null);
      return setError(`This clip is ${minutes(duration)}. The free scan takes up to 60 minutes.`);
    }
    setFile({ name: f.name, size: f.size, duration });
  };

  const useSample = () => {
    setError('');
    setFile({ name: 'CAM02_2026-10-10_1400.mp4', size: 412e6, duration: 38 * 60 + 12 });
  };

  const start = () => {
    if (!file) return setError('Choose a clip first.');
    // Real app: POST /clips (multipart: file, cameraId) or POST /scan/free (multipart: file)
    setProgress(0);
    let p = 0;
    const id = window.setInterval(() => {
      p = Math.min(100, p + 9);
      setProgress(p);
      if (p >= 100) {
        window.clearInterval(id);
        const clipId = demo.uploadClip({ fileName: file.name, sizeBytes: file.size, durationSeconds: file.duration, cameraId: free ? null : cameraId });
        navigate(`/app/clips/${clipId}`);
      }
    }, 120);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  };

  const lockedNow = screen === 'locked' || (free && demo.shop.freeScanUsed && screen === 'live');
  const capped = screen === 'limit' || (!free && camera && left <= 0);

  return (
    <>
      <PageHeader eyebrow={free ? 'Free first scan' : 'Upload'} title={free ? 'Scan a clip free' : 'Upload clip'}>
        {free ? 'One clip, up to 60 minutes. No card needed.' : 'MP4 or MOV from your recorder, up to 2 GB.'}
      </PageHeader>
      <div className="max-w-3xl px-4 py-8 sm:px-8">
        {screen === 'loading' ? (
          <>
            <LoadingAnnouncer what="upload" />
            <Skeleton className="h-11 w-72" />
            <Skeleton className="mt-6 h-56 w-full" />
          </>
        ) : screen === 'error' ? (
          <ErrorState title="The upload stopped" code="upload_interrupted" actions={<Button onClick={() => setProgress(null)}>Upload clip again</Button>}>
            The connection dropped at <span className="font-mono">62%</span>. Nothing was analysed and nothing counted against today's hours.
          </ErrorState>
        ) : lockedNow ? (
          <LockedState title="Your free scan is used." actions={<ButtonLink to="/pricing">Choose a plan</ButtonLink>}>
            Flags from it are in your review queue. To keep uploading, choose a plan from €29 a camera a month.
          </LockedState>
        ) : (
          <>
            {!free && (
              <SelectField
                label="Camera"
                hint="Clips count against that camera's 12 hours a day."
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
                className="max-w-sm"
              >
                {demo.cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name} — {hours(Math.max(0, capFor(c) - c.usedSecondsToday))} h left today
                  </option>
                ))}
              </SelectField>
            )}

            {capped ? (
              <LimitState className="mt-8" label="Daily limit reached" title={`${camera?.code ?? 'CAM 01'} has used its 12 hours today.`}
                actions={<><ButtonLink to="/pricing" variant="secondary">Add 24/7 monitoring</ButtonLink></>}>
                It starts again at midnight. Pick another camera, or add 24/7 monitoring for €16 a month.
              </LimitState>
            ) : (
              <>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={onDrop}
                  className={cn(
                    'mt-8 flex flex-col items-start gap-4 rounded-md border-2 border-dashed p-6 transition-colors duration-[140ms] sm:p-10',
                    drag ? 'border-ink bg-section' : 'border-control',
                  )}
                >
                  <UploadIcon size={24} strokeWidth={1.75} aria-hidden="true" />
                  <div>
                    <p className="text-h3">Drop a clip here</p>
                    <p className="mt-1 text-body text-ink-muted">Or choose one from this computer.</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="secondary" onClick={() => input.current?.click()}>Choose file</Button>
                    <Button variant="ghost" onClick={useSample}>Use a sample clip</Button>
                  </div>
                  <input ref={input} type="file" accept=".mp4,.mov,video/mp4,video/quicktime" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target.files?.[0])} />
                </div>
                {error && <FieldError id="upload-error">{error}</FieldError>}

                {file && (
                  <div className="anim-rise mt-6 border-y border-hairline py-4">
                    <div className="flex items-center gap-3">
                      <FileVideo size={20} strokeWidth={1.75} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-caption">{file.name}</p>
                        <p className="text-caption text-ink-muted">
                          <span className="font-mono">{fileSize(file.size)}</span> · <span className="font-mono">{minutes(file.duration)}</span>
                          {!free && camera && file.duration > left && <> · Only the first <span className="font-mono">{hours(left)}</span> h will be analysed today</>}
                        </p>
                      </div>
                      {progress == null && (
                        <button type="button" onClick={() => setFile(null)} aria-label="Remove file" className="inline-flex size-9 items-center justify-center rounded-full hover:bg-section">
                          <X size={16} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                    {progress != null && (
                      <div className="mt-4">
                        <div className="flex justify-between text-caption">
                          <span>Uploading</span>
                          <span className="font-mono tabular">{fileSize((file.size * progress) / 100)} of {fileSize(file.size)} · {progress}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-section" role="progressbar" aria-label="Upload progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                          <div className="h-full rounded-full bg-ink transition-[width] duration-150" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <Button size="lg" className="mt-8" onClick={start} disabled={progress != null} loading={progress != null}>
                  {free ? 'Scan clip free' : 'Upload clip'}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
