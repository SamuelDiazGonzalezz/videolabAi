import {
  AudioLines,
  Captions,
  Clapperboard,
  CloudUpload,
  LayoutTemplate,
  LogIn,
  LogOut,
  Palette,
  Shapes,
  ScanLine,
  Sparkles,
  Type,
  WandSparkles
} from 'lucide-react';
import './EditorToolRail.css';

export type EditorPanel = 'enhance' | 'subtitles' | 'media' | 'graphics' | 'templates' | 'brand' | 'broll' | 'transitions' | 'opening' | 'closing' | 'text' | 'audio' | 'rectangle-selection';

const TOOLS: Array<{ id: EditorPanel; label: string; icon: typeof Sparkles }> = [
  { id: 'enhance', label: 'Mejorar', icon: Sparkles },
  { id: 'subtitles', label: 'Subtítulos', icon: Captions },
  { id: 'media', label: 'Multimedia', icon: CloudUpload },
  { id: 'graphics', label: 'Elementos', icon: Shapes },
  { id: 'templates', label: 'Plantillas', icon: LayoutTemplate },
  { id: 'brand', label: 'Marca', icon: Palette },
  { id: 'broll', label: 'B-Roll', icon: Clapperboard },
  { id: 'transitions', label: 'Transiciones', icon: WandSparkles },
  { id: 'opening', label: 'Apertura', icon: LogIn },
  { id: 'closing', label: 'Cierre', icon: LogOut },
  { id: 'text', label: 'Texto', icon: Type },
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'rectangle-selection', label: 'Selección', icon: ScanLine }
];

interface EditorToolRailProps {
  active: EditorPanel | null;
  onChange: (panel: EditorPanel) => void;
}

export function EditorToolRail({ active, onChange }: EditorToolRailProps) {
  return (
    <nav className="editor-tool-rail" aria-label="Herramientas del editor">
      {TOOLS.filter(({ id }) => id !== 'rectangle-selection').map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" className={active === id ? 'is-active' : ''} onClick={() => onChange(id)}>
          <Icon size={16} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
