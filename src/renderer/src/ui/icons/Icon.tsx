import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AppWindow,
  ArrowLeftRight,
  Bold,
  Brush,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  Fingerprint,
  Stamp,
  SunMoon,
  Diamond,
  Hexagon,
  SquareDot,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleHelp,
  ClipboardPaste,
  Compass,
  Contrast,
  Copy,
  ArrowDown,
  ArrowUp,
  BringToFront,
  Eye,
  EyeOff,
  Folder,
  Group,
  ImageDown,
  Layers,
  LayersPlus,
  Lock,
  LockOpen,
  Magnet,
  Merge,
  PenTool,
  SendToBack,
  Shapes,
  SquareStack,
  Star,
  Ungroup,
  WandSparkles,
  PanelTop,
  LayoutDashboard,
  Settings,
  RotateCwSquare,
  ImageUp,
  SunMedium,
  SlidersHorizontal,
  Scale,
  Blend,
  Coffee,
  Blocks,
  SquareSplitHorizontal,
  Wind,
  Sparkles,
  Grid2x2,
  Mountain,
  ScanLine,
  Aperture,
  Layers2,
  Droplet,
  Crop,
  Eraser,
  FilePlus,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Frame,
  Grid3x3,
  History,
  ImagePlus,
  Info,
  Italic,
  Keyboard,
  Lasso,
  Maximize,
  Minus,
  Monitor,
  Moon,
  PaintBucket,
  PanelLeft,
  PanelRight,
  Pencil,
  Pentagon,
  Pipette,
  Plus,
  Printer,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Save,
  Scaling,
  Scissors,
  Slash,
  Spline,
  Square,
  SquareDashed,
  Strikethrough,
  Sun,
  Trash2,
  Type,
  Underline,
  Undo2,
  Wallpaper,
  X,
  ZoomIn,
  ZoomOut,
  Scan,
  Expand,
  Palette,
  Scale3d,
  Move,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceBetween,
  AlignVerticalSpaceBetween,
  ArrowUpFromLine,
  ArrowDownToLine,
  CircleDashed,
  SquaresUnite,
  SquaresSubtract,
  SquaresIntersect,
  Feather,
  BookmarkPlus,
  Bookmark,
  ClipboardCopy,
  Shrink,
  Fullscreen,
  type LucideIcon,
} from 'lucide-react';
import type { JSX } from 'react';

const LUCIDE: Record<string, LucideIcon> = {
  pencil: Pencil,
  brush: Brush,
  eraser: Eraser,
  fill: PaintBucket,
  picker: Pipette,
  zoom: ZoomIn,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
  text: Type,
  line: Slash,
  curve: Spline,
  rect: Square,
  ellipse: Circle,
  polygon: Pentagon,
  select: SquareDashed,
  lasso: Lasso,
  'ellipse-select': CircleDashed,
  transform: Scale3d,
  move: Move,
  'shape-align-left': AlignStartVertical,
  'shape-align-hcenter': AlignCenterVertical,
  'shape-align-right': AlignEndVertical,
  'shape-align-top': AlignStartHorizontal,
  'shape-align-vcenter': AlignCenterHorizontal,
  'shape-align-bottom': AlignEndHorizontal,
  'distribute-h': AlignHorizontalSpaceBetween,
  'distribute-v': AlignVerticalSpaceBetween,
  'bring-forward': ArrowUpFromLine,
  'send-backward': ArrowDownToLine,
  'sel-add': SquaresUnite,
  'sel-subtract': SquaresSubtract,
  'sel-intersect': SquaresIntersect,
  feather: Feather,
  'save-selection': BookmarkPlus,
  'load-selection': Bookmark,
  paste: ClipboardPaste,
  cut: Scissors,
  copy: Copy,
  crop: Crop,
  resize: Scaling,
  'canvas-size': Frame,
  'copy-image': ClipboardCopy,
  trim: Shrink,
  'fit-canvas': Fullscreen,
  'rotate-cw': RotateCw,
  'rotate-ccw': RotateCcw,
  'flip-h': FlipHorizontal2,
  'flip-v': FlipVertical2,
  invert: Contrast,
  'simple-mode': PanelTop,
  'full-mode': LayoutDashboard,
  settings: Settings,
  'rotate-view': RotateCwSquare,
  reference: ImageUp,
  brightness: SunMedium,
  levels: SlidersHorizontal,
  balance: Scale,
  grayscale: Blend,
  sepia: Coffee,
  posterize: Blocks,
  threshold: SquareSplitHorizontal,
  motion: Wind,
  noise: Sparkles,
  pixelate: Grid2x2,
  emboss: Mountain,
  edges: ScanLine,
  vignette: Aperture,
  shadow: Layers2,
  glow: Sun,
  outline: SquareDashed,
  new: FilePlus,
  open: FolderOpen,
  save: Save,
  undo: Undo2,
  redo: Redo2,
  print: Printer,
  wallpaper: Wallpaper,
  grid: Grid3x3,
  ruler: Ruler,
  fullscreen: Maximize,
  'panel-right': PanelRight,
  'panel-left': PanelLeft,
  history: History,
  navigator: Compass,
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strike: Strikethrough,
  'align-left': AlignLeft,
  'align-center': AlignCenter,
  'align-right': AlignRight,
  swap: ArrowLeftRight,
  keyboard: Keyboard,
  info: Info,
  help: CircleHelp,
  system: Monitor,
  sun: Sun,
  moon: Moon,
  contrast: Contrast,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft,
  'path-close': Hexagon,
  'path-open': Spline,
  'point-smooth': CircleDot,
  'point-corner': SquareDot,
  symmetry: FlipHorizontal2,
  smudge: Fingerprint,
  blur: Droplet,
  sharpen: Diamond,
  clone: Stamp,
  'dodge-burn': SunMoon,
  close: X,
  minus: Minus,
  plus: Plus,
  delete: Trash2,
  'new-window': AppWindow,
  'paste-new': ImagePlus,
  'select-all': Scan,
  fit: Expand,
  alert: CircleAlert,
  properties: Info,
  palette: Palette,
  accent: Droplet,
  folder: Folder,
  layers: Layers,
  'layer-add': LayersPlus,
  merge: Merge,
  flatten: SquareStack,
  eye: Eye,
  'eye-off': EyeOff,
  lock: Lock,
  unlock: LockOpen,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  group: Group,
  ungroup: Ungroup,
  front: BringToFront,
  back: SendToBack,
  pen: PenTool,
  shapes: Shapes,
  star: Star,
  magnet: Magnet,
  wand: WandSparkles,
  export: ImageDown,
};

/** Hand-drawn icons for things Lucide doesn't cover (same 24px grid, 2px stroke). */
const CUSTOM: Record<string, JSX.Element> = {
  guides: (
    <>
      <path d="M8 2.5v19M2.5 15h19" strokeDasharray="2.5 2" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeOpacity="0.5" />
    </>
  ),
  gradient: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7 4.5v15M11 4.5v15" strokeOpacity="0.85" />
      <path d="M15 4.5v15" strokeOpacity="0.45" />
    </>
  ),
  'grad-linear': (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M8 5.5v13M12.5 5.5v13" strokeOpacity="0.6" />
    </>
  ),
  'grad-radial': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" strokeOpacity="0.6" />
    </>
  ),
  'grad-angular': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12V3.5M12 12l6 6" strokeOpacity="0.6" />
    </>
  ),
  'grad-diamond': (
    <>
      <path d="M12 3 21 12 12 21 3 12Z" strokeLinejoin="round" />
      <path d="M12 7.5 16.5 12 12 16.5 7.5 12Z" strokeLinejoin="round" strokeOpacity="0.6" />
    </>
  ),
  'tf-skew': <path d="M8 5h12l-4 14H4Z" strokeLinejoin="round" />,
  'tf-distort': <path d="M5 4.5 19.5 7 17 19.5 3.5 16Z" strokeLinejoin="round" />,
  'tf-perspective': <path d="M8 5h8l4.5 14h-17Z" strokeLinejoin="round" />,
  'poly-lasso': <path d="M12 3.5 20.5 9.6 17.3 19.5H6.7L3.5 9.6Z" strokeDasharray="3 2.4" strokeLinejoin="round" />,
  'sel-replace': <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />,
  roundRect: <rect x="3.5" y="5.5" width="17" height="13" rx="4.5" />,
  'fill-outline': <rect x="4" y="5" width="16" height="14" rx="2" />,
  'fill-solid': <rect x="4" y="5" width="16" height="14" rx="2" fill="currentColor" stroke="none" />,
  'fill-both': (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" fill="currentColor" fillOpacity="0.35" />
    </>
  ),
  'pixel-grid': (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
      <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" strokeWidth="1.2" />
    </>
  ),
  'rotate-free': (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
      <path d="M12 12l3.5-3.5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  'rotate-180': (
    <>
      <path d="M5 12a7 7 0 0 1 12.2-4.7" />
      <path d="M19 12a7 7 0 0 1-12.2 4.7" />
      <path d="M17.5 3.5v4h-4M6.5 20.5v-4h4" />
    </>
  ),
  skew: <path d="M8 5h12l-4 14H4z" />,
  'actual-size': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 10v5M15 10v5M11.5 10.5v.01M11.5 14.5v.01" strokeWidth="2.2" />
    </>
  ),
  'status-bar': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 16h18" />
    </>
  ),
  deselect: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  'invert-selection': (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="3 2.5" />
      <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" fillOpacity="0.35" />
    </>
  ),
  transparent: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="3 2.5" />
      <path d="M8 8h3v3H8zM13 13h3v3h-3z" fill="currentColor" stroke="none" />
    </>
  ),
};

export interface IconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.8, className }: IconProps) {
  const L = LUCIDE[name];
  if (L) return <L size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
  const custom = CUSTOM[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {custom ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
