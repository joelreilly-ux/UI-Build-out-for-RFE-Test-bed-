"use client";

import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { UTILITY_PALETTE, UI_PRESETS, type FavoriteColor, type UIConfig } from "./ui-config";

type WorkshopProps = {
  config: UIConfig;
  onChange: (config: UIConfig) => void;
  onReset: () => void;
};

type EyeDropperResult = { sRGBHex: string };
type EyeDropperConstructor = new () => { open: () => Promise<EyeDropperResult> };

const FAVORITES_STORAGE_KEY = "rfe-ui-workshop-favourite-colours-v1";
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(value: string) {
  return value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`;
}

function normalizePalette(input: unknown): FavoriteColor[] {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === "object" && "colors" in input
      ? (input as { colors: unknown }).colors
      : input && typeof input === "object" && "palette" in input
        ? (input as { palette: unknown }).palette
        : [];

  if (!Array.isArray(source)) return [];
  return source.flatMap((entry, index) => {
    if (typeof entry === "string" && HEX_PATTERN.test(normalizeHex(entry))) {
      return [{ name: `Imported ${index + 1}`, value: normalizeHex(entry) }];
    }
    if (entry && typeof entry === "object") {
      const item = entry as { name?: unknown; value?: unknown; hex?: unknown };
      const candidate = typeof item.value === "string" ? item.value : typeof item.hex === "string" ? item.hex : "";
      const value = normalizeHex(candidate);
      if (HEX_PATTERN.test(value)) return [{ name: typeof item.name === "string" ? item.name : `Imported ${index + 1}`, value }];
    }
    return [];
  });
}

function mergePalettes(current: FavoriteColor[], incoming: FavoriteColor[]) {
  const seen = new Set<string>();
  return [...incoming, ...current].filter((color) => {
    const value = normalizeHex(color.value);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  }).map((color) => ({ ...color, value: normalizeHex(color.value) }));
}

function hexToHsl(hex: string) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let hue = 0;
  let saturation = 0;
  const lightness = (max + min) / 2;
  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
    if (max === green) hue = (blue - red) / delta + 2;
    if (max === blue) hue = (red - green) / delta + 4;
    hue /= 6;
  }
  return { h: Math.round(hue * 360), s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const hueToRgb = (p: number, q: number, channel: number) => {
    let t = channel;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels = s === 0 ? [l, l, l] : [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
  return `#${channels.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
}

function ColorControl({ label, value, favorites, onChange, onAddFavorite }: {
  label: string;
  value: string;
  favorites: FavoriteColor[];
  onChange: (value: string) => void;
  onAddFavorite: (color: FavoriteColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const hsl = hexToHsl(value);
  const updateHsl = (next: Partial<typeof hsl>) => onChange(hslToHex(next.h ?? hsl.h, next.s ?? hsl.s, next.l ?? hsl.l));

  const pickFromScreen = async () => {
    const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (!EyeDropper) {
      setMessage("Screen picker unavailable here — use the image sampler below.");
      return;
    }
    try {
      const result = await new EyeDropper().open();
      const picked = normalizeHex(result.sRGBHex);
      onChange(picked);
      onAddFavorite({ name: "Eyedropper sample", value: picked });
      setMessage(`${picked} added to favourites`);
    } catch {
      setMessage("Eyedropper cancelled");
    }
  };

  return (
    <div className={`workshop-control workshop-color ${open ? "picker-open" : ""}`}>
      <span>{label}</span>
      <button className="color-swatch-button" style={{ backgroundColor: value }} onClick={() => setOpen((current) => !current)} aria-label={`Choose ${label} colour`} aria-expanded={open} />
      <code>{value}</code>
      {open && (
        <div className="color-editor">
          <div className="color-editor-top">
            <span className="color-preview" style={{ backgroundColor: value }} />
            <label><span>Hex</span><input value={value} maxLength={7} onChange={(event) => {
              const next = event.target.value;
              if (HEX_PATTERN.test(next)) onChange(next.toLowerCase());
            }} /></label>
          </div>
          <div className="color-picker-actions">
            <button onClick={pickFromScreen}>⌖ Pick screen colour</button>
            <button onClick={() => onAddFavorite({ name: `${label} sample`, value })}>＋ Favourite</button>
          </div>
          {message && <div className="color-picker-message" role="status">{message}</div>}
          <label className="color-channel"><span>Hue</span><input aria-label={`${label} hue`} type="range" min="0" max="360" value={hsl.h} onChange={(event) => updateHsl({ h: Number(event.target.value) })} /><output>{hsl.h}°</output></label>
          <label className="color-channel"><span>Saturation</span><input aria-label={`${label} saturation`} type="range" min="0" max="100" value={hsl.s} onChange={(event) => updateHsl({ s: Number(event.target.value) })} /><output>{hsl.s}%</output></label>
          <label className="color-channel"><span>Lightness</span><input aria-label={`${label} lightness`} type="range" min="0" max="100" value={hsl.l} onChange={(event) => updateHsl({ l: Number(event.target.value) })} /><output>{hsl.l}%</output></label>
          <span className="color-swatches-label">Favourites — click to apply</span>
          <div className="color-swatches favorite-swatches" aria-label={`${label} favourite colours`}>
            {favorites.map((swatch) => <button key={`${swatch.name}-${swatch.value}`} title={`${swatch.name} · ${swatch.value}`} style={{ backgroundColor: swatch.value }} onClick={() => onChange(swatch.value)} aria-label={`Set ${label} to ${swatch.name} ${swatch.value}`} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function RangeControl({ label, value, min, max, step = 1, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  const applyValue = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return <label className="workshop-control workshop-range"><span>{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => applyValue(Number(event.target.value))} /><span className="workshop-number"><button type="button" aria-label={`Decrease ${label}`} onClick={() => applyValue(value - step)}>−</button><input aria-label={`${label} exact value`} type="text" inputMode="decimal" value={value} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) applyValue(next); }} />{unit && <i>{unit}</i>}<button type="button" aria-label={`Increase ${label}`} onClick={() => applyValue(value + step)}>+</button></span></label>;
}

function ChoiceControl<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly T[]; onChange: (value: T) => void;
}) {
  return <label className="workshop-control workshop-choice"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value as T)}>{options.map((option) => <option key={option} value={option}>{(option[0].toUpperCase() + option.slice(1)).replaceAll("-", " ")}</option>)}</select></label>;
}

export function UIWorkshop({ config, onChange, onReset }: WorkshopProps) {
  const [open, setOpen] = useState(true);
  const [copyState, setCopyState] = useState("Copy config");
  const [favorites, setFavorites] = useState<FavoriteColor[]>(UTILITY_PALETTE);
  const [paletteText, setPaletteText] = useState("");
  const [paletteMessage, setPaletteMessage] = useState("Utility palette loaded");
  const [imageReady, setImageReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!saved) return;
    try {
      const restored = normalizePalette(JSON.parse(saved));
      if (restored.length) window.setTimeout(() => setFavorites(mergePalettes(restored, UTILITY_PALETTE)), 0);
    } catch {
      window.localStorage.removeItem(FAVORITES_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify({ palette: favorites }));
  }, [favorites]);

  const setToken = <S extends keyof UIConfig, K extends keyof UIConfig[S]>(section: S, key: K, value: UIConfig[S][K]) => {
    onChange({ ...config, [section]: { ...config[section], [key]: value } });
  };
  const addFavorite = (color: FavoriteColor) => {
    setFavorites((current) => mergePalettes(current, [{ ...color, value: normalizeHex(color.value) }]));
    setPaletteMessage(`${normalizeHex(color.value)} added to favourites`);
  };
  const importPalette = (text: string) => {
    try {
      const imported = normalizePalette(JSON.parse(text));
      if (!imported.length) throw new Error("No colours");
      setFavorites((current) => mergePalettes(current, imported));
      setPaletteMessage(`${imported.length} colours imported`);
    } catch {
      setPaletteMessage("Import needs JSON colours such as [\"#3f3055\", \"#a491be\"]");
    }
  };
  const importPaletteFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) importPalette(await file.text());
    event.target.value = "";
  };
  const importReferenceImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, 260 / image.width, 150 / image.height);
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d", { willReadFrequently: true })?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      setImageReady(true);
      setPaletteMessage("Reference loaded — click the image to sample a colour");
    };
    image.src = objectUrl;
    event.target.value = "";
  };
  const sampleImage = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) * canvas.width / rect.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) * canvas.height / rect.height)));
    const pixel = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(x, y, 1, 1).data;
    if (!pixel) return;
    const value = `#${[pixel[0], pixel[1], pixel[2]].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    addFavorite({ name: `Image sample ${favorites.length + 1}`, value });
  };
  const copyConfig = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(config, null, 2)); setCopyState("Copied"); }
    catch { setCopyState("Select JSON below"); }
    window.setTimeout(() => setCopyState("Copy config"), 1800);
  };
  const copyPalette = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ palette: favorites }, null, 2)); setPaletteMessage("Palette JSON copied"); }
    catch { setPaletteMessage("Clipboard unavailable"); }
  };

  return (
    <aside className={`ui-workshop ${open ? "open" : "closed"}`} aria-label="RFE UI Workshop">
      <button className="workshop-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span>UI</span>{open ? "Hide Workshop" : "RFE UI Workshop"}</button>
      {open && <div className="workshop-panel">
        <header><div><strong>RFE UI Workshop</strong><span>Development-only visual harness</span></div><button onClick={() => setOpen(false)} aria-label="Close workshop">×</button></header>

        <section className="workshop-presets"><h2>Presets</h2><div>{Object.entries(UI_PRESETS).map(([name, preset]) => <button key={name} onClick={() => onChange(preset)}>{name}</button>)}</div></section>

        <details open className="palette-library"><summary>Utility Colours · {favorites.length}</summary>
          <div className="palette-library-content">
            <div className="named-palette" aria-label="Favourite colour palette">
              {favorites.map((color) => <button key={`${color.name}-${color.value}`} title={`${color.name} · ${color.value}`} onClick={() => navigator.clipboard.writeText(color.value)}><i style={{ backgroundColor: color.value }} /><span>{color.name}</span><code>{color.value}</code></button>)}
            </div>
            <div className="palette-import-actions">
              <label className="file-button">Import JSON<input type="file" accept="application/json,.json" onChange={importPaletteFile} /></label>
              <label className="file-button">Sample image<input type="file" accept="image/*" onChange={importReferenceImage} /></label>
              <button onClick={copyPalette}>Copy palette</button>
              <button onClick={() => { setFavorites(UTILITY_PALETTE); setPaletteMessage("Utility palette restored"); }}>Restore Utility</button>
            </div>
            <textarea value={paletteText} onChange={(event) => setPaletteText(event.target.value)} placeholder={'Paste ["#3f3055", "#a491be"] or {"palette":[...]}'} aria-label="Palette JSON to import" />
            <button className="import-palette-button" onClick={() => importPalette(paletteText)}>Import pasted colours</button>
            <canvas ref={canvasRef} className={imageReady ? "image-sampler ready" : "image-sampler"} onClick={sampleImage} aria-label="Imported reference image colour sampler" />
            <p role="status">{paletteMessage}</p>
          </div>
        </details>

        <details open><summary>Palette</summary>
          <ColorControl label="Environment" value={config.palette.environment} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "environment", value)} />
          <ColorControl label="Panel surface" value={config.palette.window} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "window", value)} />
          <ColorControl label="Elevated surface" value={config.palette.elevated} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "elevated", value)} />
          <ColorControl label="Canvas" value={config.palette.canvas} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "canvas", value)} />
          <ColorControl label="Inspector surface" value={config.palette.inspector} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "inspector", value)} />
          <ColorControl label="Diagnostics surface" value={config.palette.diagnostics} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "diagnostics", value)} />
          <ColorControl label="Operational accent" value={config.palette.accent} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "accent", value)} />
          <ColorControl label="Selected accent" value={config.palette.selected} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "selected", value)} />
          <ColorControl label="Focus surface" value={config.palette.focus} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "focus", value)} />
          <ColorControl label="Positive state" value={config.palette.positive} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "positive", value)} />
          <ColorControl label="Disabled state" value={config.palette.disabled} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "disabled", value)} />
          <ColorControl label="Primary text" value={config.palette.primaryText} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "primaryText", value)} />
          <ColorControl label="Secondary text" value={config.palette.secondaryText} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "secondaryText", value)} />
          <ColorControl label="Muted text" value={config.palette.mutedText} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "mutedText", value)} />
          <ColorControl label="Highlighted text" value={config.palette.highlightedText} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "highlightedText", value)} />
          <ColorControl label="Subheading" value={config.palette.subheading} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "subheading", value)} />
          <ColorControl label="Selected sub-tab" value={config.palette.selectedSubTab} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "selectedSubTab", value)} />
        </details>

        <details><summary>Desktop / Window Chrome</summary>
          <ColorControl label="Desktop label" value={config.palette.desktopLabel} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "desktopLabel", value)} />
          <ColorControl label="Desktop status" value={config.palette.desktopStatus} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "desktopStatus", value)} />
          <ColorControl label="Titlebar surface" value={config.palette.titlebar} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "titlebar", value)} />
          <ColorControl label="Titlebar text" value={config.palette.titlebarText} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "titlebarText", value)} />
          <ColorControl label="Window controls" value={config.palette.titlebarControls} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "titlebarControls", value)} />
          <RangeControl label="Desktop label size" value={config.typography.desktopLabelSize} min={7} max={20} unit="px" onChange={(value) => setToken("typography", "desktopLabelSize", value)} />
          <RangeControl label="Window title size" value={config.typography.windowTitleSize} min={7} max={18} unit="px" onChange={(value) => setToken("typography", "windowTitleSize", value)} />
          <RangeControl label="Titlebar height" value={config.layout.titlebarHeight} min={28} max={64} unit="px" onChange={(value) => setToken("layout", "titlebarHeight", value)} />
        </details>

        <details open><summary>Brand / Navigation</summary>
          <ColorControl label="Sidebar surface" value={config.palette.sidebar} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "sidebar", value)} />
          <ColorControl label="Brand title" value={config.palette.brandTitle} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "brandTitle", value)} />
          <ColorControl label="Brand subtitle" value={config.palette.brandSubtitle} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "brandSubtitle", value)} />
          <ColorControl label="Navigation text" value={config.palette.navigationText} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "navigationText", value)} />
          <ColorControl label="Navigation icons" value={config.palette.navigationIcon} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "navigationIcon", value)} />
          <ColorControl label="Selected nav surface" value={config.palette.navigationSelected} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "navigationSelected", value)} />
          <ColorControl label="Selected nav text" value={config.palette.navigationSelectedText} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "navigationSelectedText", value)} />
          <ColorControl label="Selected nav icon" value={config.palette.navigationSelectedIcon} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "navigationSelectedIcon", value)} />
          <ColorControl label="Selected nav band" value={config.palette.navigationIndicator} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "navigationIndicator", value)} />
          <RangeControl label="Brand title size" value={config.typography.brandTitleSize} min={8} max={22} unit="px" onChange={(value) => setToken("typography", "brandTitleSize", value)} />
          <RangeControl label="Brand subtitle size" value={config.typography.brandSubtitleSize} min={6} max={18} unit="px" onChange={(value) => setToken("typography", "brandSubtitleSize", value)} />
          <RangeControl label="Navigation size" value={config.typography.navigationSize} min={7} max={18} unit="px" onChange={(value) => setToken("typography", "navigationSize", value)} />
          <RangeControl label="Navigation item height" value={config.layout.navigationItemHeight} min={24} max={52} unit="px" onChange={(value) => setToken("layout", "navigationItemHeight", value)} />
          <RangeControl label="Navigation gap" value={config.spacing.navigationGap} min={0} max={16} unit="px" onChange={(value) => setToken("spacing", "navigationGap", value)} />
          <RangeControl label="Selected band width" value={config.geometry.navigationIndicatorWidth} min={0} max={8} step={0.5} unit="px" onChange={(value) => setToken("geometry", "navigationIndicatorWidth", value)} />
        </details>

        <details><summary>Toolbar / Controls</summary>
          <ColorControl label="Toolbar surface" value={config.palette.toolbar} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "toolbar", value)} />
          <ColorControl label="Tool button" value={config.palette.toolSurface} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "toolSurface", value)} />
          <ColorControl label="Active tool" value={config.palette.toolActive} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "toolActive", value)} />
          <ColorControl label="Control surface" value={config.palette.controlSurface} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "controlSurface", value)} />
          <ColorControl label="Control border" value={config.palette.controlBorder} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "controlBorder", value)} />
          <ColorControl label="Slider track" value={config.palette.sliderTrack} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "sliderTrack", value)} />
          <ColorControl label="Slider thumb" value={config.palette.sliderThumb} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "sliderThumb", value)} />
          <RangeControl label="Toolbar height" value={config.layout.toolbarHeight} min={28} max={64} unit="px" onChange={(value) => setToken("layout", "toolbarHeight", value)} />
          <RangeControl label="Toolbar text size" value={config.typography.toolbarSize} min={6} max={16} unit="px" onChange={(value) => setToken("typography", "toolbarSize", value)} />
          <RangeControl label="Control text size" value={config.typography.controlSize} min={6} max={16} unit="px" onChange={(value) => setToken("typography", "controlSize", value)} />
          <RangeControl label="Control border width" value={config.geometry.controlBorderWidth} min={0} max={4} step={0.5} unit="px" onChange={(value) => setToken("geometry", "controlBorderWidth", value)} />
          <RangeControl label="Slider thickness" value={config.geometry.sliderThickness} min={1} max={8} unit="px" onChange={(value) => setToken("geometry", "sliderThickness", value)} />
          <RangeControl label="Slider thumb size" value={config.geometry.sliderThumbSize} min={5} max={20} unit="px" onChange={(value) => setToken("geometry", "sliderThumbSize", value)} />
        </details>

        <details open><summary>Layout</summary>
          <RangeControl label="Window gap" value={config.spacing.windowGap} min={4} max={32} unit="px" onChange={(value) => setToken("spacing", "windowGap", value)} />
          <RangeControl label="Navigation width" value={config.layout.navigationWidth} min={120} max={230} unit="px" onChange={(value) => setToken("layout", "navigationWidth", value)} />
          <RangeControl label="Inspector width" value={config.layout.inspectorWidth} min={240} max={400} unit="px" onChange={(value) => setToken("layout", "inspectorWidth", value)} />
          <RangeControl label="Diagnostics height" value={config.layout.diagnosticsHeight} min={112} max={220} unit="px" onChange={(value) => setToken("layout", "diagnosticsHeight", value)} />
          <RangeControl label="Workspace padding" value={config.spacing.workspacePadding} min={6} max={28} unit="px" onChange={(value) => setToken("spacing", "workspacePadding", value)} />
          <RangeControl label="Node minimum height" value={config.layout.nodeMinHeight} min={48} max={120} unit="px" onChange={(value) => setToken("layout", "nodeMinHeight", value)} />
          <RangeControl label="Section spacing" value={config.spacing.sectionSpacing} min={4} max={28} unit="px" onChange={(value) => setToken("spacing", "sectionSpacing", value)} />
          <RangeControl label="Extra-small spacing" value={config.spacing.xs} min={1} max={12} unit="px" onChange={(value) => setToken("spacing", "xs", value)} />
          <RangeControl label="Small spacing" value={config.spacing.sm} min={2} max={18} unit="px" onChange={(value) => setToken("spacing", "sm", value)} />
          <RangeControl label="Medium spacing" value={config.spacing.md} min={4} max={24} unit="px" onChange={(value) => setToken("spacing", "md", value)} />
          <RangeControl label="Large spacing" value={config.spacing.lg} min={8} max={36} unit="px" onChange={(value) => setToken("spacing", "lg", value)} />
          <RangeControl label="Extra-large spacing" value={config.spacing.xl} min={12} max={48} unit="px" onChange={(value) => setToken("spacing", "xl", value)} />
        </details>
        <details><summary>Geometry</summary>
          <RangeControl label="Window radius" value={config.geometry.windowRadius} min={0} max={24} unit="px" onChange={(value) => setToken("geometry", "windowRadius", value)} />
          <RangeControl label="Node radius" value={config.geometry.nodeRadius} min={0} max={18} unit="px" onChange={(value) => setToken("geometry", "nodeRadius", value)} />
          <RangeControl label="Control radius" value={config.geometry.controlRadius} min={0} max={14} unit="px" onChange={(value) => setToken("geometry", "controlRadius", value)} />
          <RangeControl label="Border intensity" value={config.geometry.borderOpacity} min={0.04} max={0.4} step={0.01} onChange={(value) => setToken("geometry", "borderOpacity", value)} />
          <RangeControl label="Shadow intensity" value={config.geometry.shadowOpacity} min={0} max={0.5} step={0.01} onChange={(value) => setToken("geometry", "shadowOpacity", value)} />
          <RangeControl label="Shadow blur" value={config.geometry.shadowBlur} min={8} max={80} unit="px" onChange={(value) => setToken("geometry", "shadowBlur", value)} />
          <ColorControl label="Edge band" value={config.palette.edgeBand} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "edgeBand", value)} />
          <RangeControl label="Edge band size" value={config.geometry.edgeBandSize} min={0} max={8} step={0.5} unit="px" onChange={(value) => setToken("geometry", "edgeBandSize", value)} />
        </details>
        <details><summary>Typography</summary>
          <RangeControl label="Base size" value={config.typography.baseSize} min={10} max={18} unit="px" onChange={(value) => setToken("typography", "baseSize", value)} />
          <RangeControl label="Labels" value={config.typography.labelSize} min={6} max={12} unit="px" onChange={(value) => setToken("typography", "labelSize", value)} />
          <RangeControl label="Headings" value={config.typography.headingSize} min={9} max={18} unit="px" onChange={(value) => setToken("typography", "headingSize", value)} />
          <RangeControl label="Readouts" value={config.typography.readoutSize} min={15} max={30} unit="px" onChange={(value) => setToken("typography", "readoutSize", value)} />
          <RangeControl label="Subheadings" value={config.typography.subheadingSize} min={5} max={16} unit="px" onChange={(value) => setToken("typography", "subheadingSize", value)} />
          <RangeControl label="Node titles" value={config.typography.nodeTitleSize} min={7} max={20} unit="px" onChange={(value) => setToken("typography", "nodeTitleSize", value)} />
          <RangeControl label="Node details" value={config.typography.nodeDetailSize} min={5} max={14} unit="px" onChange={(value) => setToken("typography", "nodeDetailSize", value)} />
          <RangeControl label="Inspector title" value={config.typography.inspectorTitleSize} min={9} max={26} unit="px" onChange={(value) => setToken("typography", "inspectorTitleSize", value)} />
          <RangeControl label="Diagnostics footer" value={config.typography.footerSize} min={5} max={12} unit="px" onChange={(value) => setToken("typography", "footerSize", value)} />
          <RangeControl label="Regular weight" value={config.typography.regularWeight} min={300} max={700} step={10} onChange={(value) => setToken("typography", "regularWeight", value)} />
          <RangeControl label="Strong weight" value={config.typography.strongWeight} min={400} max={900} step={10} onChange={(value) => setToken("typography", "strongWeight", value)} />
          <RangeControl label="Line height" value={config.typography.lineHeight} min={1} max={2} step={0.05} onChange={(value) => setToken("typography", "lineHeight", value)} />
        </details>
        <details open><summary>Nodes / Threads</summary>
          <ColorControl label="Canvas grid" value={config.palette.canvasGrid} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "canvasGrid", value)} />
          <ColorControl label="Node surface" value={config.palette.nodeSurface} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "nodeSurface", value)} />
          <ColorControl label="Node border" value={config.palette.nodeBorder} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "nodeBorder", value)} />
          <ColorControl label="Node title" value={config.palette.nodeTitle} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "nodeTitle", value)} />
          <ColorControl label="Node details" value={config.palette.nodeDetail} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "nodeDetail", value)} />
          <ColorControl label="Selected node surface" value={config.palette.nodeSelectedSurface} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "nodeSelectedSurface", value)} />
          <ColorControl label="Selected node border" value={config.palette.nodeSelectedBorder} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "nodeSelectedBorder", value)} />
          <ColorControl label="Port fill" value={config.palette.port} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "port", value)} />
          <ColorControl label="Port border" value={config.palette.portBorder} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "portBorder", value)} />
          <RangeControl label="Node width" value={config.nodes.nodeWidth} min={112} max={190} unit="px" onChange={(value) => setToken("nodes", "nodeWidth", value)} />
          <RangeControl label="Node padding" value={config.nodes.nodePadding} min={6} max={22} unit="px" onChange={(value) => setToken("nodes", "nodePadding", value)} />
          <RangeControl label="Node border width" value={config.geometry.nodeBorderWidth} min={0} max={5} step={0.5} unit="px" onChange={(value) => setToken("geometry", "nodeBorderWidth", value)} />
          <RangeControl label="Selected border width" value={config.geometry.selectedNodeBorderWidth} min={0} max={6} step={0.5} unit="px" onChange={(value) => setToken("geometry", "selectedNodeBorderWidth", value)} />
          <RangeControl label="Thread thickness" value={config.nodes.threadWidth} min={0.5} max={4} step={0.5} unit="px" onChange={(value) => setToken("nodes", "threadWidth", value)} />
          <RangeControl label="Thread opacity" value={config.nodes.threadOpacity} min={0.1} max={1} step={0.05} onChange={(value) => setToken("nodes", "threadOpacity", value)} />
          <ColorControl label="Thread outline" value={config.palette.threadOutline} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "threadOutline", value)} />
          <ColorControl label="Thread core" value={config.palette.thread} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "thread", value)} />
          <RangeControl label="Thread outline width" value={config.nodes.threadOutlineWidth} min={0} max={4} step={0.5} unit="px" onChange={(value) => setToken("nodes", "threadOutlineWidth", value)} />
          <RangeControl label="Port size" value={config.nodes.portSize} min={4} max={14} unit="px" onChange={(value) => setToken("nodes", "portSize", value)} />
          <RangeControl label="Port border width" value={config.geometry.portBorderWidth} min={0} max={5} step={0.5} unit="px" onChange={(value) => setToken("geometry", "portBorderWidth", value)} />
          <RangeControl label="Selected emphasis" value={config.nodes.selectedEmphasis} min={0.1} max={1} step={0.05} onChange={(value) => setToken("nodes", "selectedEmphasis", value)} />
        </details>
        <details open><summary>Highlights</summary>
          <ChoiceControl label="Highlight style" value={config.nodes.groupingAccentStyle} options={["inset-bar", "full-border"] as const} onChange={(value) => setToken("nodes", "groupingAccentStyle", value)} />
          <RangeControl label="Inset from top" value={config.nodes.groupingAccentInset} min={1} max={12} step={0.5} unit="px" onChange={(value) => setToken("nodes", "groupingAccentInset", value)} />
          <RangeControl label="Inset from sides" value={config.nodes.groupingAccentSideInset} min={1} max={20} step={0.5} unit="px" onChange={(value) => setToken("nodes", "groupingAccentSideInset", value)} />
          <RangeControl label="Highlight weight" value={config.nodes.groupingAccentThickness} min={1} max={1.5} step={0.5} unit="px" onChange={(value) => setToken("nodes", "groupingAccentThickness", value)} />
        </details>
        <details open><summary>Diagnostics Focus</summary>
          <ChoiceControl label="Highlight style" value={config.diagnostics.focusStyle} options={["neutral", "outline", "band"] as const} onChange={(value) => setToken("diagnostics", "focusStyle", value)} />
          <ColorControl label="Highlight colour" value={config.palette.diagnosticsFocus} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "diagnosticsFocus", value)} />
          <ColorControl label="Readout colour" value={config.palette.diagnosticsValue} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "diagnosticsValue", value)} />
          <ColorControl label="Meter bars" value={config.palette.diagnosticsBars} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "diagnosticsBars", value)} />
          <ColorControl label="Footer surface" value={config.palette.diagnosticsFooter} favorites={favorites} onAddFavorite={addFavorite} onChange={(value) => setToken("palette", "diagnosticsFooter", value)} />
        </details>
        <div className="workshop-actions"><button onClick={onReset}>Reset to Baseline</button><button onClick={copyConfig}>{copyState}</button></div>
        <details className="workshop-export"><summary>Export preview</summary><textarea readOnly value={JSON.stringify(config, null, 2)} aria-label="Current UI configuration JSON" /></details>
        <p>Saved locally in this browser. Application controls and experiment state are unaffected.</p>
      </div>}
    </aside>
  );
}
