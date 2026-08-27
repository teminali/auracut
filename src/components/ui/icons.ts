/* ═══════════════════════════════════════════════════════════════════
   The platform icon set — one file, so it is one file to change.

   Phosphor, not lucide. The upgrade is not "nicer drawings": Phosphor
   ships SIX WEIGHTS of every glyph, and the one that matters is `fill`.
   A single-weight stroke set can only signal an active state by
   changing colour, which is why every toolbar in this app used to look
   flat — a selected tool and an unselected one were the same shape in
   two colours. Idle is `regular`, active is `fill`, and that reads
   instantly at 16px without any colour at all.

   **Every component imports icons FROM HERE, never from a package.**
   The names below are the ones the codebase already used, so swapping
   the underlying set again is this file and nothing else. That is the
   whole point of it existing: the last swap touched 52 files, and the
   next one should touch one.

   `weight` is a prop on every icon, so a call site that needs the fill
   variant asks for it inline:

       <Play weight={playing ? 'fill' : 'regular'} />

   Sizing goes through `size`, and stroke-based utilities (`stroke-[1.6]`)
   do NOTHING to a Phosphor glyph — it is a filled path, not a stroked
   one. Use `weight` instead.
   ═══════════════════════════════════════════════════════════════════ */

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

export type { PhosphorIcon };
export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';

/**
 * The default weight for the whole app.
 *
 * `regular` at Phosphor's own optical sizing sits very close to the
 * 1.6px stroke this UI used before, so nothing had to be re-spaced when
 * the set changed. `bold` is reserved for 12px-and-under, where regular
 * loses its counters.
 */
export { IconContext } from '@phosphor-icons/react';

export { Pulse as Activity } from '@phosphor-icons/react';
export { WarningCircle as AlertCircle } from '@phosphor-icons/react';
export { Warning as AlertTriangle } from '@phosphor-icons/react';
export { TextAlignCenter as AlignCenter } from '@phosphor-icons/react';
export { AlignCenterHorizontal as AlignHorizontalJustifyCenter } from '@phosphor-icons/react';
export { AlignRight as AlignHorizontalJustifyEnd } from '@phosphor-icons/react';
export { AlignLeft as AlignHorizontalJustifyStart } from '@phosphor-icons/react';
export { AlignCenterHorizontal as AlignHorizontalSpaceAround } from '@phosphor-icons/react';
export { TextAlignLeft as AlignLeft } from '@phosphor-icons/react';
export { TextAlignRight as AlignRight } from '@phosphor-icons/react';
export { AlignCenterVertical as AlignVerticalJustifyCenter } from '@phosphor-icons/react';
export { AlignBottom as AlignVerticalJustifyEnd } from '@phosphor-icons/react';
export { AlignTop as AlignVerticalJustifyStart } from '@phosphor-icons/react';
export { AlignCenterVertical as AlignVerticalSpaceAround } from '@phosphor-icons/react';
export { ArrowsLeftRight as ArrowLeftRight } from '@phosphor-icons/react';
export { ArrowRight } from '@phosphor-icons/react';
export { ArrowUp } from '@phosphor-icons/react';
export { ArrowUpRight } from '@phosphor-icons/react';
export { WaveSine as AudioLines } from '@phosphor-icons/react';
export { SealCheck as BadgeCheck } from '@phosphor-icons/react';
export { SquaresFour as Blocks } from '@phosphor-icons/react';
export { TextB as Bold } from '@phosphor-icons/react';
export { Camera } from '@phosphor-icons/react';
export { TextAa as CaseUpper } from '@phosphor-icons/react';
export { Check } from '@phosphor-icons/react';
export { CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
export { CaretDown as ChevronDown } from '@phosphor-icons/react';
export { CaretLeft as ChevronLeft } from '@phosphor-icons/react';
export { CaretRight as ChevronRight } from '@phosphor-icons/react';
export { CaretUp as ChevronUp } from '@phosphor-icons/react';
export { Circle } from '@phosphor-icons/react';
export { WarningCircle as CircleAlert } from '@phosphor-icons/react';
export { FilmSlate as Clapperboard } from '@phosphor-icons/react';
export { Clock } from '@phosphor-icons/react';
export { Columns as Columns2 } from '@phosphor-icons/react';
export { Command } from '@phosphor-icons/react';
export { CircleHalf as Contrast } from '@phosphor-icons/react';
export { Copy } from '@phosphor-icons/react';
export { Cpu } from '@phosphor-icons/react';
export { Crop } from '@phosphor-icons/react';
export { Crosshair } from '@phosphor-icons/react';
export { Diamond } from '@phosphor-icons/react';
export { DownloadSimple as Download } from '@phosphor-icons/react';
export { EarSlash as EarOff } from '@phosphor-icons/react';
export { ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';
export { Eye } from '@phosphor-icons/react';
export { EyeSlash as EyeOff } from '@phosphor-icons/react';
export { FileText } from '@phosphor-icons/react';
export { FilmStrip as Film } from '@phosphor-icons/react';
export { Flag } from '@phosphor-icons/react';
export { FlipHorizontal as FlipHorizontal2 } from '@phosphor-icons/react';
export { FlipVertical as FlipVertical2 } from '@phosphor-icons/react';
export { FolderOpen } from '@phosphor-icons/react';
export { Gauge } from '@phosphor-icons/react';
export { Globe } from '@phosphor-icons/react';
export { GridNine as Grid3x3 } from '@phosphor-icons/react';
export { Headphones } from '@phosphor-icons/react';
export { Heart } from '@phosphor-icons/react';
export { Hexagon } from '@phosphor-icons/react';
export { Image } from '@phosphor-icons/react';
export { Info } from '@phosphor-icons/react';
export { TextItalic as Italic } from '@phosphor-icons/react';
export { Key as KeyRound } from '@phosphor-icons/react';
export { Keyboard } from '@phosphor-icons/react';
export { Stack as Layers } from '@phosphor-icons/react';
export { StackSimple as Layers2 } from '@phosphor-icons/react';
export { SquaresFour as LayoutGrid } from '@phosphor-icons/react';
export { Lightbulb } from '@phosphor-icons/react';
export { ChartLine as LineChart } from '@phosphor-icons/react';
export { List } from '@phosphor-icons/react';
export { CircleNotch as Loader2 } from '@phosphor-icons/react';
export { Lock } from '@phosphor-icons/react';
export { SignIn as LogIn } from '@phosphor-icons/react';
export { SignOut as LogOut } from '@phosphor-icons/react';
export { Magnet } from '@phosphor-icons/react';
export { MapPin } from '@phosphor-icons/react';
export { CornersOut as Maximize } from '@phosphor-icons/react';
export { ArrowsOut as Maximize2 } from '@phosphor-icons/react';
export { Chat as MessageSquare } from '@phosphor-icons/react';
export { Microphone as Mic } from '@phosphor-icons/react';
export { ArrowsIn as Minimize2 } from '@phosphor-icons/react';
export { Minus } from '@phosphor-icons/react';
export { Cursor as MousePointer2 } from '@phosphor-icons/react';
export { Selection as MousePointerSquareDashed } from '@phosphor-icons/react';
export { ArrowsOutCardinal as Move3d } from '@phosphor-icons/react';
export { ArrowRight as MoveRight } from '@phosphor-icons/react';
export { MusicNote as Music } from '@phosphor-icons/react';
export { MusicNotes as Music4 } from '@phosphor-icons/react';
export { PaintBucket } from '@phosphor-icons/react';
export { Palette } from '@phosphor-icons/react';
export { SidebarSimple as PanelLeftClose } from '@phosphor-icons/react';
export { SidebarSimple as PanelRightClose } from '@phosphor-icons/react';
export { Pause } from '@phosphor-icons/react';
export { Pencil } from '@phosphor-icons/react';
export { Play } from '@phosphor-icons/react';
export { Plus } from '@phosphor-icons/react';
export { FrameCorners as Ratio } from '@phosphor-icons/react';
export { ArrowUUpRight as Redo2 } from '@phosphor-icons/react';
export { ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
export { Repeat } from '@phosphor-icons/react';
export { Rewind } from '@phosphor-icons/react';
export { ArrowCounterClockwise as RotateCcw } from '@phosphor-icons/react';
export { Path as Route } from '@phosphor-icons/react';
export { Rows as Rows3 } from '@phosphor-icons/react';
export { FloppyDisk as Save } from '@phosphor-icons/react';
export { Scan as ScanEye } from '@phosphor-icons/react';
export { Scissors } from '@phosphor-icons/react';
export { Scissors as ScissorsLineDashed } from '@phosphor-icons/react';
export { MagnifyingGlass as Search } from '@phosphor-icons/react';
export { HardDrives as Server } from '@phosphor-icons/react';
export { GearSix as Settings } from '@phosphor-icons/react';
export { Shapes } from '@phosphor-icons/react';
export { ShieldWarning as ShieldAlert } from '@phosphor-icons/react';
export { ShieldCheck } from '@phosphor-icons/react';
export { SkipBack } from '@phosphor-icons/react';
export { SkipForward } from '@phosphor-icons/react';
export { SlidersHorizontal as Sliders } from '@phosphor-icons/react';
export { DeviceMobile as Smartphone } from '@phosphor-icons/react';
export { Snowflake } from '@phosphor-icons/react';
/*
  THE AI MARK, and the one line in this file that is a product decision.

  Phosphor's `Sparkle` is the MULTI-star: a large four-point shine with
  two or three smaller ones around it, which is the glyph on every AI
  product shipped in the last few years. HANDOVER's Iconography note
  removed exactly that once already, in favour of the single four-point
  shine, and the migration to this set quietly put it back.

  `StarFour` is the single shine. Verified by counting subpaths in the
  packaged path data rather than by eye: Sparkle draws three to four
  shapes per weight, StarFour draws one.

  Exported under the name the codebase already uses, so the fix is this
  line and nothing else.
*/
export { StarFour as Sparkle } from '@phosphor-icons/react';
export { BezierCurve as Spline } from '@phosphor-icons/react';
export { ArrowsSplit as Split } from '@phosphor-icons/react';
export { Square } from '@phosphor-icons/react';
export { Star } from '@phosphor-icons/react';
export { ClosedCaptioning as Subtitles } from '@phosphor-icons/react';
export { Sun } from '@phosphor-icons/react';
export { Terminal } from '@phosphor-icons/react';
export { TerminalWindow as TerminalSquare } from '@phosphor-icons/react';
export { Timer } from '@phosphor-icons/react';
export { Trash as Trash2 } from '@phosphor-icons/react';
export { Triangle } from '@phosphor-icons/react';
export { TextT as Type } from '@phosphor-icons/react';
export { ArrowUUpLeft as Undo2 } from '@phosphor-icons/react';
export { LinkBreak as Unlink } from '@phosphor-icons/react';
export { LockOpen as Unlock } from '@phosphor-icons/react';
export { UploadSimple as Upload } from '@phosphor-icons/react';
export { VideoCamera as Video } from '@phosphor-icons/react';
export { SpeakerHigh as Volume2 } from '@phosphor-icons/react';
export { SpeakerSlash as VolumeX } from '@phosphor-icons/react';
export { Waves } from '@phosphor-icons/react';
export { WifiSlash as WifiOff } from '@phosphor-icons/react';
export { Wind } from '@phosphor-icons/react';
export { Wrench } from '@phosphor-icons/react';
export { X } from '@phosphor-icons/react';
export { Lightning as Zap } from '@phosphor-icons/react';
export { MagnifyingGlassPlus as ZoomIn } from '@phosphor-icons/react';
export { MagnifyingGlassMinus as ZoomOut } from '@phosphor-icons/react';
