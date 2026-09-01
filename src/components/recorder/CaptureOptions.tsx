/* ═══════════════════════════════════════════════════════════════════
   The right rail of the studio: what goes into the take.

   Two rules this panel is built around.

   **Show the camera, do not describe it.** A dropdown reading
   "FaceTime HD Camera" does not tell you the lid is half closed, that
   the lamp behind you is blowing the frame out, or that the wrong
   camera is selected on a machine with three. A live preview does, and
   it costs one low-resolution stream.

   **Show the microphone too.** The single most common way a screen
   recording is ruined is a muted or wrong input, discovered after
   twenty minutes of talking. The meter is not decoration: it is the
   only thing on this panel that can prove the take will have sound.

   The preview streams are deliberately SMALL — 640x360 and whatever the
   default sample rate is. They are thrown away when recording starts
   and the real streams are opened at full resolution, so previewing
   costs nothing in the file.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { SliderRow, ToggleRow, SegmentedControl } from '../ui/Controls';
import { DeviceOption, previewCamera, previewMicrophone } from '../../engine/screenCapture';
import { StickySettings } from '../../store/recorderStore';
import { RecorderPermissions } from '../../types/electron';
import { BACKDROPS, BackdropId } from '../../engine/cinematicLook';

/*
  A short list on purpose. Whisper handles a hundred languages and a
  hundred-row picker is a worse control than a text field; these are
  `Detect` plus the ones a screen tutorial is actually narrated in often
  enough to be worth one tap. Anything else goes through the skill's
  `language` argument, which takes any code Whisper knows.
*/
const SPOKEN_LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: 'Detect' },
  { code: 'en', label: 'English' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
];
import {
  Camera, Mic, MicOff, VideoOff, Monitor, CursorClick, AlertTriangle, Sparkle, Waves,
  Broadcast,
} from '../ui/icons';

interface Props {
  settings: StickySettings;
  cameras: DeviceOption[];
  microphones: DeviceOption[];
  permissions: RecorderPermissions | null;
  /** True when a whole display was chosen, which is what auto zoom needs. */
  canAutoZoom: boolean;
  onChange: <K extends keyof StickySettings>(key: K, value: StickySettings[K]) => void;
  onRequestPermission: (kind: 'camera' | 'microphone' | 'screen' | 'accessibility') => void;
}

export const CaptureOptions: React.FC<Props> = ({
  settings, cameras, microphones, permissions, canAutoZoom, onChange, onRequestPermission,
}) => (
  <div className="w-[288px] flex-shrink-0 border-l border-line overflow-y-auto">
    <Group title="Camera" icon={Camera}>
      <DeviceSelect
        value={settings.cameraDeviceId}
        options={cameras}
        emptyLabel="No camera"
        onChange={(id) => onChange('cameraDeviceId', id)}
      />
      {cameras.length === 0 && (
        <button
          type="button"
          onClick={() => onRequestPermission('camera')}
          className="w-full h-7 px-2 text-ui-xs rounded bg-spectrum-accent/15 text-spectrum-accent hover:bg-spectrum-accent/25 transition-colors font-medium flex items-center justify-center gap-1.5"
        >
          <Camera className="w-3.5 h-3.5" />
          Enable Camera
        </button>
      )}
      <CameraPreview
        deviceId={settings.cameraDeviceId}
        mirror={settings.mirrorCamera}
        onEnable={() => onRequestPermission('camera')}
      />

      {settings.cameraDeviceId && (
        <>
          <ToggleRow
            label="Mirror camera"
            checked={settings.mirrorCamera}
            onChange={(v) => onChange('mirrorCamera', v)}
            hint="Flip horizontally like a mirror"
          />
          <SegmentedControl
            value={String(settings.cameraHeight) as '720' | '1080'}
            options={[{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }]}
            onChange={(v) => onChange('cameraHeight', Number(v) as 720 | 1080)}
          />
          <SegmentedControl
            value={settings.cameraCorner}
            options={[
              { value: 'bottom-right', label: 'BR', title: 'Bottom right' },
              { value: 'bottom-left', label: 'BL', title: 'Bottom left' },
              { value: 'top-right', label: 'TR', title: 'Top right' },
              { value: 'top-left', label: 'TL', title: 'Top left' },
            ]}
            onChange={(v) => onChange('cameraCorner', v)}
          />
          <SliderRow
            label="Inset size"
            value={settings.cameraSizePct}
            onChange={(v) => onChange('cameraSizePct', Math.round(v))}
            min={10}
            max={45}
            unit="%"
          />
        </>
      )}

      {permissions?.camera === 'denied' && (
        <PermissionNote
          text="Camera access is off for TeminaliCut."
          action="Open settings"
          onAction={() => onRequestPermission('camera')}
        />
      )}
    </Group>

    <Group title="Sound" icon={Mic}>
      <DeviceSelect
        value={settings.micDeviceId}
        options={microphones}
        emptyLabel="No microphone"
        onChange={(id) => onChange('micDeviceId', id)}
      />
      {microphones.length === 0 && (
        <button
          type="button"
          onClick={() => onRequestPermission('microphone')}
          className="w-full h-7 px-2 text-ui-xs rounded bg-spectrum-accent/15 text-spectrum-accent hover:bg-spectrum-accent/25 transition-colors font-medium flex items-center justify-center gap-1.5"
        >
          <Mic className="w-3.5 h-3.5" />
          Enable Microphone
        </button>
      )}
      <MicMeter deviceId={settings.micDeviceId} />

      <ToggleRow
        label="System audio"
        checked={settings.systemAudio}
        onChange={(v) => onChange('systemAudio', v)}
        hint="What the machine is playing"
      />

      {/* The caveat as a paragraph rather than as a hint: `ToggleRow`
          truncates its hint to one line, and a warning cut off mid-word
          is worse than no warning. */}
      {permissions && permissions.platform !== 'win32' && settings.systemAudio && (
        <p className="text-micro text-spectrum-textFaint leading-relaxed">
          Only Windows exposes a loopback device. It is asked for anyway, in case one is
          installed here; if there is none the screen clip simply has no sound of its own
          and the take says so.
        </p>
      )}

      {permissions?.microphone === 'denied' && (
        <PermissionNote
          text="Microphone access is off for TeminaliCut."
          action="Open settings"
          onAction={() => onRequestPermission('microphone')}
        />
      )}
    </Group>

    <Group title="Capture" icon={Monitor}>
      <Row label="Frame rate">
        <SegmentedControl
          value={String(settings.fps) as '30' | '60'}
          options={[{ value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }]}
          onChange={(v) => onChange('fps', Number(v) as 30 | 60)}
        />
      </Row>

      <Row label="Resolution">
        <SegmentedControl
          value={String(settings.maxWidth) as '0' | '2560' | '1920'}
          options={[
            { value: '0', label: 'Native', title: 'The display’s own resolution' },
            { value: '2560', label: '1440p' },
            { value: '1920', label: '1080p' },
          ]}
          onChange={(v) => onChange('maxWidth', Number(v))}
        />
      </Row>

      <Row label="Countdown">
        <SegmentedControl
          value={String(settings.countdownSec) as '0' | '3' | '5'}
          options={[
            { value: '0', label: 'None' },
            { value: '3', label: '3s' },
            { value: '5', label: '5s' },
          ]}
          onChange={(v) => onChange('countdownSec', Number(v) as 0 | 3 | 5)}
        />
      </Row>

      <ToggleRow
        label="Hide TeminaliCut while recording"
        checked={settings.hideWindow}
        onChange={(v) => onChange('hideWindow', v)}
        hint="A floating bar stays, and it is kept out of the capture"
      />
    </Group>

    <Group title="Auto zoom" icon={CursorClick}>
      <ToggleRow
        label="Push in where you worked"
        checked={settings.autoZoom && canAutoZoom}
        onChange={(v) => onChange('autoZoom', v)}
        hint={
          canAutoZoom
            ? 'Keyframes on the screen clip, editable afterwards'
            : 'Needs a whole display. A single window has no frame to place the pointer in'
        }
      />

      {settings.autoZoom && canAutoZoom && (
        <>
          <SliderRow
            label="Strength"
            value={settings.zoomFactor}
            onChange={(v) => onChange('zoomFactor', Math.round(v * 100) / 100)}
            min={1.15}
            max={2.4}
            step={0.05}
            precision={2}
            unit="x"
          />
          <ToggleRow
            label="Motion blur on the push"
            checked={settings.motionBlur}
            onChange={(v) => onChange('motionBlur', v)}
            hint="Cinematic, and four times the preview cost while it moves"
          />
        </>
      )}

      {/* What the zoom is actually built from, said before the take
          rather than discovered after it. The two answers are genuinely
          different in quality and the difference is not visible in the
          result unless somebody says so. */}
      <p className="text-micro text-spectrum-textFaint leading-relaxed">
        {permissions?.input?.ok
          ? 'Zooms land on real clicks, scrolls and typing. Press Alt+Shift+Z during a take to mark one yourself.'
          : permissions?.input?.message
            ?? 'Zooms are placed from where the pointer travelled to and stopped.'}
      </p>

      {permissions?.input?.reason === 'needs-accessibility' && (
        <PermissionNote
          text="Turn TeminaliCut on under Accessibility for zooms on real clicks."
          action="Open settings"
          onAction={() => onRequestPermission('accessibility')}
        />
      )}
    </Group>

    <Group title="Tutorial skill" icon={Sparkle}>
      <p className="text-micro text-spectrum-textFaint leading-relaxed">
        Offered after the take, alongside opening it raw. Everything it does lands as normal
        clips and keyframes.
      </p>

      <ToggleRow
        label="Cinematic frame"
        checked={settings.cinematic}
        onChange={(v) => onChange('cinematic', v)}
        hint="Inset on a backdrop, rounded, opening and close"
      />

      {settings.cinematic && (
        <>
          <SegmentedControl
            value={settings.backdrop}
            options={[
              ...BACKDROPS.map((b) => ({ value: b.id, label: b.label })),
              { value: 'none' as BackdropId, label: 'None' },
            ]}
            onChange={(v) => onChange('backdrop', v)}
            /* Nine of them now that the light set is here; two columns
               made a very tall stack of very wide buttons. */
            columns={3}
          />
          <SliderRow
            label="Inset"
            value={settings.insetPct}
            onChange={(v) => onChange('insetPct', Math.round(v))}
            min={70}
            max={100}
            unit="%"
          />
        </>
      )}

      <ToggleRow
        label="Camera fills the frame on pauses"
        checked={settings.cameraOnPauses}
        onChange={(v) => onChange('cameraOnPauses', v)}
        hint="While you are talking and not doing"
      />

      {settings.cameraOnPauses && settings.cameraDeviceId && settings.cameraHeight < 1080 && (
        <p className="text-micro text-spectrum-amber leading-relaxed">
          At 720p the camera cannot fill the frame without looking soft, so it will stay an
          inset. Record the camera at 1080p to use this.
        </p>
      )}

      <ToggleRow
        label="Click ticks and zoom air"
        checked={settings.clickSounds}
        onChange={(v) => onChange('clickSounds', v)}
        hint="Synthesised, written into the take folder"
      />

      <ToggleRow
        label="Captions in Inter Bold"
        checked={settings.captions}
        onChange={(v) => onChange('captions', v)}
        hint="Transcribed on device, and the words place the camera cuts"
      />

      {/*
        The spoken language, and it earns its place in the rail rather
        than living in a menu somewhere: the words are what decide the
        camera cuts and whether the take opens on your face, so getting
        this wrong does not merely lose the captions, it loses the edit.

        `Detect` is the default and works now that `-l auto` is actually
        passed. It reads the language ONCE from the start of the file, so
        a take that opens in one language and carries on in another wants
        the language set by hand.
      */}
      {settings.captions && (
        <SegmentedControl
          value={settings.language}
          options={SPOKEN_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          onChange={(v) => onChange('language', v)}
          columns={3}
        />
      )}

      <ToggleRow
        label="Narration on its own track"
        checked={settings.detachNarration}
        onChange={(v) => onChange('detachNarration', v)}
        hint="So cutting the camera does not cut your voice"
      />
    </Group>

    {/*
      Going live is LAST, under the settings that decide what a stream
      would look like, because it is a render of them. It is also the
      only group here that reaches the outside world, which is a reason
      not to have it sitting at the top under somebody's thumb.
    */}
    <Group title="Go live" icon={Broadcast}>
      <ToggleRow
        label="Stream while recording"
        checked={settings.streamEnabled}
        onChange={(v) => onChange('streamEnabled', v)}
        hint="The same picture the editor would build, pushed to an RTMP ingest"
      />

      {settings.streamEnabled && (
        <>
          <input
            type="password"
            value={settings.streamUrl}
            onChange={(e) => onChange('streamUrl', e.target.value)}
            placeholder="rtmp://a.rtmp.youtube.com/live2/your-key"
            spellCheck={false}
            autoComplete="off"
            className="w-full h-8 px-2 rounded bg-spectrum-panel border border-line
                       text-ui-sm text-spectrum-text placeholder:text-spectrum-textDim
                       focus:outline-none focus:border-accent"
            aria-label="RTMP ingest address"
          />
          {/*
            A password field, because the stream key is IN the address.
            Anyone who reads it over your shoulder can broadcast to your
            channel until you reset it, and a recorder is a thing people
            run while sharing their screen.
          */}
          <p className="text-ui-xs text-spectrum-textDim leading-relaxed">
            The address ends with your stream key, so it is hidden as you type. The
            recording is unaffected either way: it is written from the same capture
            at full quality, and the stream is the copy that gets dropped if this
            machine cannot keep up.
          </p>

          <Row label="Send at">
            <SegmentedControl
              value={String(settings.streamHeight)}
              options={[{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }]}
              onChange={(v) => onChange('streamHeight', Number(v) as 720 | 1080)}
            />
          </Row>

          <ToggleRow
            label="Real-Time Closed Captions"
            checked={settings.captions}
            onChange={(v) => onChange('captions', v)}
            hint="Burns live subtitles and speaker tags into outgoing RTMP stream via VibeVoice"
          />
        </>
      )}
    </Group>
  </div>
);

/* ── Pieces ─────────────────────────────────────────────────────── */

const Group: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({
  title, icon: Icon, children,
}) => (
  <div className="border-b border-line last:border-b-0 px-3 py-3 space-y-2.5">
    <div className="flex items-center gap-1.5">
      <Icon className="w-3 h-3 text-spectrum-textDim flex-shrink-0" />
      <span className="section-label">{title}</span>
    </div>
    {children}
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5">
    <span className="prop-label">{label}</span>
    {children}
  </div>
);

const DeviceSelect: React.FC<{
  value: string | null;
  options: DeviceOption[];
  emptyLabel: string;
  onChange: (id: string | null) => void;
}> = ({ value, options, emptyLabel, onChange }) => (
  <select
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value || null)}
    className="pro-input w-full h-7 px-2 text-ui-sm outline-none"
    aria-label={emptyLabel}
  >
    <option value="">{emptyLabel}</option>
    {options.map((option) => (
      <option key={option.deviceId} value={option.deviceId}>{option.label}</option>
    ))}
  </select>
);

const CameraPreview: React.FC<{
  deviceId: string | null;
  mirror?: boolean;
  onEnable?: () => void;
}> = ({
  deviceId, mirror = true, onEnable,
}) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!deviceId) return;
    let stream: MediaStream | null = null;
    let cancelled = false;

    void previewCamera(deviceId)
      .then((result) => {
        // The pick can change while `getUserMedia` is still resolving; a
        // stream that arrives after that has to be closed, not shown.
        if (cancelled) { result.getTracks().forEach((t) => t.stop()); return; }
        stream = result;
        setError(null);
        if (videoRef.current) videoRef.current.srcObject = result;
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);

  if (!deviceId) {
    return (
      <div
        onClick={onEnable}
        role="button"
        tabIndex={0}
        className="aspect-video rounded-squircle-sm bg-spectrum-sunken border border-line
                   flex flex-col items-center justify-center gap-1 cursor-pointer
                   hover:bg-white/[0.04] transition-colors p-2 text-center"
        title="Click to enable camera"
      >
        <VideoOff className="w-5 h-5 text-spectrum-textFaint" />
        <span className="text-micro text-spectrum-textDim">Click to enable camera</span>
      </div>
    );
  }

  return (
    <div className="aspect-video rounded-squircle-sm bg-black border border-line overflow-hidden relative">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover transition-transform duration-200"
        style={{ transform: mirror ? 'scaleX(-1)' : 'none' }}
      />
      {error && (
        <span className="absolute inset-0 flex items-center justify-center px-3 text-center
                         text-micro text-spectrum-red bg-black/70">
          {error}
        </span>
      )}
    </div>
  );
};

/**
 * A live level, not a fake one.
 *
 * Reads the analyser's time-domain buffer and shows peak, because RMS
 * on a quiet room barely moves and the question this answers is "is
 * anything reaching the input at all".
 */
const MicMeter: React.FC<{ deviceId: string | null }> = ({ deviceId }) => {
  const [level, setLevel] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLevel(0);
    if (!deviceId) return;

    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    let cancelled = false;

    void previewMicrophone(deviceId)
      .then((result) => {
        if (cancelled) { result.getTracks().forEach((t) => t.stop()); return; }
        stream = result;
        setError(null);

        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(result).connect(analyser);

        const buffer = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buffer);
          let peak = 0;
          for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128) / 128);
          // Decay, so the bar reads as a level rather than as a strobe.
          setLevel((previous) => Math.max(peak, previous * 0.86));
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, [deviceId]);

  if (!deviceId) {
    return (
      <div className="flex items-center gap-2 h-6">
        <MicOff className="w-3.5 h-3.5 text-spectrum-textFaint flex-shrink-0" />
        <span className="text-micro text-spectrum-textFaint">The take will be silent</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 h-6">
      <Mic className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
      <div className="flex-1 h-1.5 rounded-full bg-spectrum-sunken overflow-hidden border border-line">
        <div
          className="h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${Math.min(100, level * 140)}%`,
            background: level > 0.85 ? '#f0334f' : 'var(--accent)',
          }}
        />
      </div>
      {error && <span className="text-micro text-spectrum-red truncate max-w-[110px]">{error}</span>}
    </div>
  );
};

const PermissionNote: React.FC<{ text: string; action: string; onAction: () => void }> = ({
  text, action, onAction,
}) => (
  <div className="flex items-start gap-1.5 rounded-squircle-xs bg-spectrum-amber/10 border border-spectrum-amber/25 px-2 py-1.5">
    <AlertTriangle className="w-3 h-3 text-spectrum-amber flex-shrink-0 mt-px" />
    <div className="min-w-0 space-y-1">
      <p className="text-micro text-spectrum-textMuted leading-snug">{text}</p>
      <button onClick={onAction} className="text-micro text-spectrum-accent hover:underline">{action}</button>
    </div>
  </div>
);
