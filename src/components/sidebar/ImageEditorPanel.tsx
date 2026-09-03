import React, { useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { Section } from '../ui/Controls';
import { Sparkle, Image as ImageIcon, Plus, Scissors, Settings } from '../ui/icons';
import { generateImage, removeBackground, getCredentials, setCredentials } from '../../services/cloudflareAi';

export const ImageEditorPanel: React.FC = () => {
  const pushToast = useUiStore((s) => s.pushToast);
  const addMediaAsset = useTimelineStore((s) => s.addMediaAsset);

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const creds = getCredentials();
  const [accountId, setAccountId] = useState(creds.accountId);
  const [token, setToken] = useState(creds.token);

  const handleSaveSettings = () => {
    setCredentials(accountId.trim(), token.trim());
    pushToast({ kind: 'success', title: 'Settings saved' });
    setShowSettings(false);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      pushToast({ kind: 'error', title: 'Prompt cannot be empty' });
      return;
    }
    
    setBusy('generating');
    try {
      const dataUrl = await generateImage(prompt);
      setGeneratedImage(dataUrl);
      pushToast({ kind: 'success', title: 'Image generated successfully' });
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Generation failed', detail: err.message });
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveBackground = async () => {
    if (!generatedImage) return;
    setBusy('rembg');
    try {
      const dataUrl = await removeBackground(generatedImage);
      setGeneratedImage(dataUrl);
      pushToast({ kind: 'success', title: 'Background removed' });
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Background removal failed', detail: err.message });
    } finally {
      setBusy(null);
    }
  };

  const handleAddToProject = async () => {
    if (!generatedImage) return;
    
    try {
      const response = await fetch(generatedImage);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      const newAsset = {
        id: crypto.randomUUID(),
        name: `ai-image-${Date.now()}.png`,
        type: 'image' as const,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        durationMs: 5000,
        fileSizeFormatted: `${(blob.size / 1024).toFixed(1)} KB`,
      };
      
      addMediaAsset(newAsset);
      pushToast({ kind: 'success', title: 'Added to media pool' });
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Failed to add to project', detail: err.message });
    }
  };

  return (
    <div className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header flex items-center justify-between">
        <span className="panel-title">AI Image Editor</span>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-1 rounded text-spectrum-textFaint hover:text-spectrum-text transition-colors ${showSettings ? 'text-spectrum-accent' : ''}`}
          title="Cloudflare API Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showSettings && (
          <Section title="API Configuration" icon={Settings}>
            <div className="space-y-2 mb-3">
              <div>
                <label className="text-micro text-spectrum-textFaint block mb-1">Account ID</label>
                <input
                  type="text"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full h-7 bg-spectrum-darker border border-line rounded px-2 text-ui text-spectrum-text focus:border-spectrum-accent focus:outline-none"
                  placeholder="Cloudflare Account ID"
                />
              </div>
              <div>
                <label className="text-micro text-spectrum-textFaint block mb-1">API Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full h-7 bg-spectrum-darker border border-line rounded px-2 text-ui text-spectrum-text focus:border-spectrum-accent focus:outline-none"
                  placeholder="Cloudflare API Token"
                />
              </div>
              <button
                onClick={handleSaveSettings}
                className="btn-primary w-full h-6 text-micro mt-1"
              >
                Save Credentials
              </button>
            </div>
          </Section>
        )}

        <Section title="Generate" icon={Sparkle}>
          <p className="text-micro text-spectrum-textFaint leading-relaxed mb-2">
            Describe the image you want to generate with Flux.1.
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A cute fluffy baby fox sitting in a magical forest..."
            className="w-full h-24 bg-spectrum-darker border border-line rounded-squircle-sm p-2 text-ui text-spectrum-text placeholder:text-spectrum-textFaint focus:border-spectrum-accent focus:outline-none resize-none mb-3 transition-colors"
            disabled={busy !== null}
          />
          <button
            onClick={handleGenerate}
            disabled={busy !== null || !prompt.trim()}
            className="btn-primary w-full h-7 gap-1.5 text-ui-sm disabled:opacity-50"
          >
            <Sparkle className="w-3 h-3" /> 
            {busy === 'generating' ? 'Generating...' : 'Generate Image'}
          </button>
        </Section>

        {generatedImage && (
          <Section title="Preview & Edit" icon={ImageIcon}>
            <div className="aspect-square w-full rounded-squircle-sm overflow-hidden bg-spectrum-darker border border-line mb-3 relative checkerboard">
              <img 
                src={generatedImage} 
                alt="Generated AI Image" 
                className="w-full h-full object-contain absolute inset-0"
              />
              {busy === 'rembg' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <span className="text-ui-sm text-spectrum-textBright font-medium">Removing...</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <button
                onClick={handleRemoveBackground}
                disabled={busy !== null}
                className="pro-btn-filled w-full h-7 gap-1.5 text-ui-sm disabled:opacity-50"
              >
                <Scissors className="w-3 h-3" /> Remove Background
              </button>
              
              <button
                onClick={handleAddToProject}
                disabled={busy !== null}
                className="pro-btn-filled w-full h-7 gap-1.5 text-ui-sm disabled:opacity-50 !bg-spectrum-green/20 hover:!bg-spectrum-green/30 !text-spectrum-green"
              >
                <Plus className="w-3 h-3" /> Add to Media Pool
              </button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
};
