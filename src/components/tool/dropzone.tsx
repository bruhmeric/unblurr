'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileStack, FolderOpen, ImagePlus, ClipboardPaste, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useUntrace } from '@/lib/untrace/store';
import { MAX_FILES, formatBytes } from '@/lib/untrace/types';
import { cn } from '@/lib/utils';

const ACCEPTED = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff'];

function isImageFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ACCEPTED.includes(ext) || file.type.startsWith('image/');
}

export function Dropzone() {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const addFiles = useUntrace((s) => s.addFiles);
  const count = useUntrace((s) => s.items.length);
  const totalBytes = useUntrace((s) => s.items.reduce((a, i) => a + i.size, 0));
  const running = useUntrace((s) => s.running);

  const accept = useCallback(
    (fileList: FileList | File[] | null) => {
      if (!fileList) return;
      const files = Array.from(fileList);
      const images = files.filter(isImageFile);
      const rejected = files.length - images.length;
      if (images.length === 0) {
        toast.error('No images found', {
          description: 'Supported: JPEG, PNG, WebP, GIF, AVIF, HEIC, BMP, TIFF.',
        });
        return;
      }
      const { added, skipped, reason } = addFiles(images);
      if (added > 0) {
        toast.success(`Added ${added} image${added > 1 ? 's' : ''}`, {
          description: `${count + added} / ${MAX_FILES} in batch · ${formatBytes(totalBytes + images.reduce((a, f) => a + f.size, 0))}`,
        });
      }
      if (rejected > 0) {
        toast.warning(`${rejected} non-image file${rejected > 1 ? 's' : ''} skipped`);
      }
      if (reason) toast.info(reason);
    },
    [addFiles, count, totalBytes]
  );

  /* clipboard paste support */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) accept(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [accept]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    accept(e.dataTransfer?.files ?? null);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop images here or click to browse"
      onClick={() => !running && fileInput.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !running) {
          e.preventDefault();
          fileInput.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={cn(
        'group relative flex min-h-[280px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300',
        dragging
          ? 'border-emerald-400/70 bg-emerald-400/[0.07] scale-[1.005]'
          : 'border-white/12 bg-white/[0.02] hover:border-emerald-400/40 hover:bg-white/[0.04]',
        running && 'pointer-events-none opacity-60'
      )}
    >
      {/* scanline flourish */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-14 animate-scan-line bg-gradient-to-b from-transparent via-emerald-400/10 to-transparent" aria-hidden="true" />

      <div
        className={cn(
          'mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] transition-transform duration-300',
          dragging ? 'scale-110 border-emerald-400/50' : 'group-hover:scale-105'
        )}
      >
        <UploadCloud className={cn('h-8 w-8 transition-colors', dragging ? 'text-emerald-300' : 'text-slate-400 group-hover:text-emerald-300')} />
      </div>

      <p className="font-display text-xl font-semibold text-slate-100">
        {dragging ? 'Release to load images' : 'Drop images here'}
      </p>
      <p className="mt-1.5 text-sm text-slate-400">
        or click to browse · paste from clipboard · up to {MAX_FILES} images per batch
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        <Button
          size="sm"
          variant="secondary"
          className="gap-2 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]"
          onClick={(e) => {
            e.stopPropagation();
            fileInput.current?.click();
          }}
        >
          <ImagePlus className="h-4 w-4" /> Choose files
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="gap-2 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]"
          onClick={(e) => {
            e.stopPropagation();
            folderInput.current?.click();
          }}
        >
          <FolderOpen className="h-4 w-4" /> Add folder
        </Button>
        <span className="hidden items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-500 sm:flex">
          <ClipboardPaste className="h-3.5 w-3.5" /> Ctrl+V
        </span>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><FileStack className="h-3 w-3" /> JPEG · PNG · WebP · GIF</span>
        <span>AVIF · HEIC · BMP · TIFF*</span>
      </div>
      <p className="mt-2 max-w-md text-[11px] leading-relaxed text-slate-600">
        *AVIF, HEIC, TIFF and BMP support depends on your browser.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,.heic,.heif,.avif,.tif,.tiff"
        multiple
        hidden
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        multiple
        // @ts-expect-error non-standard but widely supported
        webkitdirectory="true"
        directory=""
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
