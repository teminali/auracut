import React, { useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { Section } from '../ui/Controls';
import { Sparkle, Image as ImageIcon, Plus, Scissors, Download } from '../ui/icons';
import { generateImage, removeBackground } from '../../services/cloudflareAi';

export const ImageEditorPanel: React.FC = () => {
  const pushToast = useUiStore((s) => s.pushToast);
  const addMediaAsset = useTimelineStore((s) => s.addMediaAsset);

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

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
    
    // We need to fetch the data URL and convert to blob to add it to the media pool
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
      <div className="panel-header">
        <span className="panel-title">AI Image Editor</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Generate" icon={Sparkle}>
          <p className="text-micro text-spectrum-textFaint leading-relaxed mb-2">
            Describe the image you want to generate.
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
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm">
                  <span className="text-ui-sm text-white font-medium">Removing...</span>
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
