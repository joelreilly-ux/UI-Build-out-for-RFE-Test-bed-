export type UIConfig = {
  palette: {
    environment: string;
    window: string;
    elevated: string;
    canvas: string;
    inspector: string;
    diagnostics: string;
    accent: string;
    selected: string;
    focus: string;
    thread: string;
    disabled: string;
    positive: string;
    warning: string;
    primaryText: string;
    secondaryText: string;
    mutedText: string;
    highlightedText: string;
    subheading: string;
    edgeBand: string;
    threadOutline: string;
    diagnosticsFocus: string;
    selectedSubTab: string;
    desktopLabel: string;
    desktopStatus: string;
    titlebar: string;
    titlebarText: string;
    titlebarControls: string;
    sidebar: string;
    brandTitle: string;
    brandSubtitle: string;
    navigationText: string;
    navigationIcon: string;
    navigationSelected: string;
    navigationSelectedText: string;
    navigationSelectedIcon: string;
    navigationIndicator: string;
    toolbar: string;
    toolSurface: string;
    toolActive: string;
    canvasGrid: string;
    nodeSurface: string;
    nodeBorder: string;
    nodeTitle: string;
    nodeDetail: string;
    nodeSelectedSurface: string;
    nodeSelectedBorder: string;
    port: string;
    portBorder: string;
    controlSurface: string;
    controlBorder: string;
    sliderTrack: string;
    sliderThumb: string;
    diagnosticsValue: string;
    diagnosticsBars: string;
    diagnosticsFooter: string;
  };
  typography: {
    baseSize: number;
    labelSize: number;
    headingSize: number;
    readoutSize: number;
    regularWeight: number;
    strongWeight: number;
    lineHeight: number;
    subheadingSize: number;
    desktopLabelSize: number;
    brandTitleSize: number;
    brandSubtitleSize: number;
    windowTitleSize: number;
    navigationSize: number;
    toolbarSize: number;
    nodeTitleSize: number;
    nodeDetailSize: number;
    inspectorTitleSize: number;
    controlSize: number;
    footerSize: number;
  };
  geometry: {
    windowRadius: number;
    nodeRadius: number;
    controlRadius: number;
    borderOpacity: number;
    shadowOpacity: number;
    shadowBlur: number;
    edgeBandSize: number;
    nodeBorderWidth: number;
    selectedNodeBorderWidth: number;
    controlBorderWidth: number;
    navigationIndicatorWidth: number;
    portBorderWidth: number;
    sliderThickness: number;
    sliderThumbSize: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    windowGap: number;
    workspacePadding: number;
    sectionSpacing: number;
    navigationGap: number;
  };
  layout: {
    navigationWidth: number;
    inspectorWidth: number;
    diagnosticsHeight: number;
    titlebarHeight: number;
    toolbarHeight: number;
    navigationItemHeight: number;
    nodeMinHeight: number;
  };
  nodes: {
    nodeWidth: number;
    nodePadding: number;
    groupingAccentStyle: "inset-bar" | "full-border";
    groupingAccentInset: number;
    groupingAccentSideInset: number;
    groupingAccentThickness: number;
    threadWidth: number;
    threadOpacity: number;
    portSize: number;
    selectedEmphasis: number;
    threadOutlineWidth: number;
  };
  diagnostics: {
    focusStyle: "neutral" | "outline" | "band";
  };
};

export type FavoriteColor = { name: string; value: string };
export type ThemeMode = "light" | "dark";
export type AccentId = "coral" | "stone" | "moss" | "utility-blue" | "air-blue" | "signal-red";
export type MutedAccent = FavoriteColor & { id: AccentId };

export const MUTED_ACCENTS: MutedAccent[] = [
  { id: "coral", name: "Muted Coral", value: "#d47a65" },
  { id: "stone", name: "Warm Stone", value: "#cfc7bd" },
  { id: "moss", name: "Moss Green", value: "#a9b98a" },
  { id: "utility-blue", name: "Utility Blue", value: "#3d5a85" },
  { id: "air-blue", name: "Air Blue", value: "#7fa6bf" },
  { id: "signal-red", name: "Signal Red", value: "#b4444f" },
];

export const UTILITY_PALETTE: FavoriteColor[] = [
  { name: "Desktop", value: "#fafbfc" },
  { name: "Panel", value: "#f3f4f6" },
  { name: "Canvas", value: "#ffffff" },
  { name: "Divider", value: "#e2e5e9" },
  { name: "Primary Text", value: "#111827" },
  { name: "Secondary Text", value: "#6b7280" },
  ...MUTED_ACCENTS,
];

export const BASELINE_UI_CONFIG: UIConfig = {
  palette: {
    environment: "#fafbfc",
    window: "#f3f4f6",
    elevated: "#eef0f2",
    canvas: "#ffffff",
    inspector: "#f3f4f6",
    diagnostics: "#f3f4f6",
    accent: "#3d5a85",
    selected: "#d47a65",
    focus: "#e2e5e9",
    thread: "#8b939d",
    disabled: "#a4aab2",
    positive: "#476b52",
    warning: "#b4444f",
    primaryText: "#111827",
    secondaryText: "#596170",
    mutedText: "#596170",
    highlightedText: "#111827",
    subheading: "#596170",
    edgeBand: "#e2e5e9",
    threadOutline: "#ffffff",
    diagnosticsFocus: "#476b52",
    selectedSubTab: "#dfe2e6",
    desktopLabel: "#111827",
    desktopStatus: "#596170",
    titlebar: "#f3f4f6",
    titlebarText: "#111827",
    titlebarControls: "#9aa1aa",
    sidebar: "#f3f4f6",
    brandTitle: "#111827",
    brandSubtitle: "#596170",
    navigationText: "#374151",
    navigationIcon: "#596170",
    navigationSelected: "#e8eaed",
    navigationSelectedText: "#111827",
    navigationSelectedIcon: "#374151",
    navigationIndicator: "#596170",
    toolbar: "#f3f4f6",
    toolSurface: "#f8f9fa",
    toolActive: "#e2e5e9",
    canvasGrid: "#cbd1d8",
    nodeSurface: "#ffffff",
    nodeBorder: "#cfd4da",
    nodeTitle: "#111827",
    nodeDetail: "#596170",
    nodeSelectedSurface: "#ffffff",
    nodeSelectedBorder: "#d47a65",
    port: "#ffffff",
    portBorder: "#8b939d",
    controlSurface: "#ffffff",
    controlBorder: "#cfd4da",
    sliderTrack: "#cfd4da",
    sliderThumb: "#596170",
    diagnosticsValue: "#111827",
    diagnosticsBars: "#596170",
    diagnosticsFooter: "#eef0f2",
  },
  typography: {
    baseSize: 14,
    labelSize: 7,
    headingSize: 12,
    readoutSize: 23,
    regularWeight: 450,
    strongWeight: 620,
    lineHeight: 1.4,
    subheadingSize: 7,
    desktopLabelSize: 11,
    brandTitleSize: 12,
    brandSubtitleSize: 9,
    windowTitleSize: 11,
    navigationSize: 11,
    toolbarSize: 8,
    nodeTitleSize: 11,
    nodeDetailSize: 7,
    inspectorTitleSize: 15,
    controlSize: 8,
    footerSize: 6,
  },
  geometry: {
    windowRadius: 8,
    nodeRadius: 10,
    controlRadius: 0,
    borderOpacity: 0.04,
    shadowOpacity: 0.08,
    shadowBlur: 18,
    edgeBandSize: 1,
    nodeBorderWidth: 1,
    selectedNodeBorderWidth: 1,
    controlBorderWidth: 1,
    navigationIndicatorWidth: 2,
    portBorderWidth: 2,
    sliderThickness: 2,
    sliderThumbSize: 9,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 18,
    xl: 24,
    windowGap: 10,
    workspacePadding: 12,
    sectionSpacing: 13,
    navigationGap: 4,
  },
  layout: {
    navigationWidth: 175,
    inspectorWidth: 321,
    diagnosticsHeight: 137,
    titlebarHeight: 42,
    toolbarHeight: 43,
    navigationItemHeight: 34,
    nodeMinHeight: 48,
  },
  nodes: {
    nodeWidth: 135,
    nodePadding: 8,
    groupingAccentStyle: "inset-bar",
    groupingAccentInset: 1,
    groupingAccentSideInset: 3,
    groupingAccentThickness: 1.5,
    threadWidth: 1,
    threadOpacity: 0.3,
    portSize: 4,
    selectedEmphasis: 0.5,
    threadOutlineWidth: 0,
  },
  diagnostics: {
    focusStyle: "band",
  },
};

export const DARK_UI_CONFIG: UIConfig = {
  ...BASELINE_UI_CONFIG,
  palette: {
    ...BASELINE_UI_CONFIG.palette,
    environment: "#0f1215",
    window: "#15191d",
    elevated: "#191e23",
    canvas: "#101418",
    inspector: "#15191d",
    diagnostics: "#15191d",
    accent: "#7fa6bf",
    selected: "#d47a65",
    focus: "#252c33",
    thread: "#66717c",
    disabled: "#59616a",
    positive: "#a9b98a",
    warning: "#d16468",
    primaryText: "#e7e9ec",
    secondaryText: "#a2a9b2",
    mutedText: "#737c86",
    highlightedText: "#f6f7f8",
    subheading: "#8e97a1",
    edgeBand: "#2b3239",
    threadOutline: "#101418",
    diagnosticsFocus: "#a9b98a",
    selectedSubTab: "#2a3036",
    desktopLabel: "#d7dbe0",
    desktopStatus: "#929aa4",
    titlebar: "#15191d",
    titlebarText: "#e7e9ec",
    titlebarControls: "#69727c",
    sidebar: "#15191d",
    brandTitle: "#e7e9ec",
    brandSubtitle: "#a2a9b2",
    navigationText: "#c3c8ce",
    navigationIcon: "#7d8791",
    navigationSelected: "#20262c",
    navigationSelectedText: "#f0f2f4",
    navigationSelectedIcon: "#aab2bb",
    navigationIndicator: "#8e97a1",
    toolbar: "#15191d",
    toolSurface: "#181d22",
    toolActive: "#252c33",
    canvasGrid: "#4e5964",
    nodeSurface: "#151a1f",
    nodeBorder: "#39424a",
    nodeTitle: "#e7e9ec",
    nodeDetail: "#929aa4",
    nodeSelectedSurface: "#151a1f",
    nodeSelectedBorder: "#d47a65",
    port: "#151a1f",
    portBorder: "#7d8791",
    controlSurface: "#11161a",
    controlBorder: "#343c44",
    sliderTrack: "#343c44",
    sliderThumb: "#a2a9b2",
    diagnosticsValue: "#e7e9ec",
    diagnosticsBars: "#8e97a1",
    diagnosticsFooter: "#11161a",
  },
  geometry: { ...BASELINE_UI_CONFIG.geometry, shadowOpacity: 0.18, shadowBlur: 20 },
  spacing: { ...BASELINE_UI_CONFIG.spacing, workspacePadding: 12 },
  layout: { ...BASELINE_UI_CONFIG.layout, nodeMinHeight: 48 },
  nodes: { ...BASELINE_UI_CONFIG.nodes, nodeWidth: 135, nodePadding: 8 },
};

export const UI_PRESETS: Record<string, UIConfig> = {
  "Light Utility": BASELINE_UI_CONFIG,
  "Dark Utility": DARK_UI_CONFIG,
  "Spacious Light": {
    ...BASELINE_UI_CONFIG,
    spacing: { ...BASELINE_UI_CONFIG.spacing, windowGap: 20, workspacePadding: 12, sectionSpacing: 16 },
    layout: { ...BASELINE_UI_CONFIG.layout, navigationWidth: 184, inspectorWidth: 328, diagnosticsHeight: 164, nodeMinHeight: 48 },
    nodes: { ...BASELINE_UI_CONFIG.nodes, nodeWidth: 135, nodePadding: 8 },
  },
  Compact: {
    ...BASELINE_UI_CONFIG,
    typography: { ...BASELINE_UI_CONFIG.typography, baseSize: 12, labelSize: 7, headingSize: 10, readoutSize: 18 },
    spacing: { ...BASELINE_UI_CONFIG.spacing, windowGap: 8, workspacePadding: 12, sectionSpacing: 10 },
    layout: { ...BASELINE_UI_CONFIG.layout, navigationWidth: 145, inspectorWidth: 270, diagnosticsHeight: 132, nodeMinHeight: 48 },
    nodes: { ...BASELINE_UI_CONFIG.nodes, nodeWidth: 135, nodePadding: 8, portSize: 6 },
  },
};

export const UI_CONFIG_REVISION = "approved-ui-interaction-baseline-2026-08-11-08";
export const UI_CONFIG_STORAGE_KEY = "rfe-ui-workshop-config-v5";
export const UI_THEME_STORAGE_KEY = "rfe-ui-theme-v1";
export const MODULE_ACCENTS_STORAGE_KEY = "rfe-module-accents-v1";

export function mergeUIConfig(value: unknown, baseline: UIConfig = BASELINE_UI_CONFIG): UIConfig {
  if (!value || typeof value !== "object") return baseline;
  const candidate = value as Partial<UIConfig>;
  return {
    palette: { ...baseline.palette, ...candidate.palette },
    typography: { ...baseline.typography, ...candidate.typography },
    geometry: { ...baseline.geometry, ...candidate.geometry },
    spacing: { ...baseline.spacing, ...candidate.spacing },
    layout: { ...baseline.layout, ...candidate.layout },
    nodes: { ...baseline.nodes, ...candidate.nodes },
    diagnostics: { ...baseline.diagnostics, ...candidate.diagnostics },
  };
}

export function configToCSSVariables(config: UIConfig): Record<string, string | number> {
  return {
    "--desktop": config.palette.environment,
    "--window": config.palette.window,
    "--window-raised": config.palette.elevated,
    "--canvas": config.palette.canvas,
    "--inspector": config.palette.inspector,
    "--diagnostics": config.palette.diagnostics,
    "--accent": config.palette.accent,
    "--accent-soft": config.palette.selected,
    "--focus-surface": config.palette.focus,
    "--thread-color": config.palette.thread,
    "--disabled": config.palette.disabled,
    "--green": config.palette.positive,
    "--warning": config.palette.warning,
    "--text": config.palette.primaryText,
    "--text-soft": config.palette.secondaryText,
    "--text-dim": config.palette.mutedText,
    "--text-highlighted": config.palette.highlightedText,
    "--subheading-color": config.palette.subheading,
    "--edge-band-color": config.palette.edgeBand,
    "--border": config.palette.edgeBand,
    "--border-strong": config.palette.edgeBand,
    "--thread-outline-color": config.palette.threadOutline,
    "--diagnostics-focus-color": config.palette.diagnosticsFocus,
    "--selected-subtab-color": config.palette.selectedSubTab,
    "--desktop-label-color": config.palette.desktopLabel,
    "--desktop-status-color": config.palette.desktopStatus,
    "--titlebar-color": config.palette.titlebar,
    "--titlebar-text-color": config.palette.titlebarText,
    "--titlebar-controls-color": config.palette.titlebarControls,
    "--sidebar-color": config.palette.sidebar,
    "--brand-title-color": config.palette.brandTitle,
    "--brand-subtitle-color": config.palette.brandSubtitle,
    "--navigation-text-color": config.palette.navigationText,
    "--navigation-icon-color": config.palette.navigationIcon,
    "--navigation-selected-color": config.palette.navigationSelected,
    "--navigation-selected-text-color": config.palette.navigationSelectedText,
    "--navigation-selected-icon-color": config.palette.navigationSelectedIcon,
    "--navigation-indicator-color": config.palette.navigationIndicator,
    "--toolbar-color": config.palette.toolbar,
    "--tool-surface-color": config.palette.toolSurface,
    "--tool-active-color": config.palette.toolActive,
    "--canvas-grid-color": config.palette.canvasGrid,
    "--node-surface-color": config.palette.nodeSurface,
    "--node-border-color": config.palette.nodeBorder,
    "--node-title-color": config.palette.nodeTitle,
    "--node-detail-color": config.palette.nodeDetail,
    "--node-selected-surface-color": config.palette.nodeSelectedSurface,
    "--node-selected-border-color": config.palette.nodeSelectedBorder,
    "--port-color": config.palette.port,
    "--port-border-color": config.palette.portBorder,
    "--control-surface-color": config.palette.controlSurface,
    "--control-border-color": config.palette.controlBorder,
    "--slider-track-color": config.palette.sliderTrack,
    "--slider-thumb-color": config.palette.sliderThumb,
    "--diagnostics-value-color": config.palette.diagnosticsValue,
    "--diagnostics-bars-color": config.palette.diagnosticsBars,
    "--diagnostics-footer-color": config.palette.diagnosticsFooter,
    "--type-base": `${config.typography.baseSize}px`,
    "--type-label": `${config.typography.labelSize}px`,
    "--type-heading": `${config.typography.headingSize}px`,
    "--type-readout": `${config.typography.readoutSize}px`,
    "--weight-regular": config.typography.regularWeight,
    "--weight-strong": config.typography.strongWeight,
    "--line-height": config.typography.lineHeight,
    "--type-subheading": `${config.typography.subheadingSize}px`,
    "--type-desktop-label": `${config.typography.desktopLabelSize}px`,
    "--type-brand-title": `${config.typography.brandTitleSize}px`,
    "--type-brand-subtitle": `${config.typography.brandSubtitleSize}px`,
    "--type-window-title": `${config.typography.windowTitleSize}px`,
    "--type-navigation": `${config.typography.navigationSize}px`,
    "--type-toolbar": `${config.typography.toolbarSize}px`,
    "--type-node-title": `${config.typography.nodeTitleSize}px`,
    "--type-node-detail": `${config.typography.nodeDetailSize}px`,
    "--type-inspector-title": `${config.typography.inspectorTitleSize}px`,
    "--type-control": `${config.typography.controlSize}px`,
    "--type-footer": `${config.typography.footerSize}px`,
    "--radius-window": `${config.geometry.windowRadius}px`,
    "--radius-node": `${config.geometry.nodeRadius}px`,
    "--radius-control": `${config.geometry.controlRadius}px`,
    "--border-opacity": config.geometry.borderOpacity,
    "--shadow-opacity": config.geometry.shadowOpacity,
    "--shadow-blur": `${config.geometry.shadowBlur}px`,
    "--edge-band-size": `${config.geometry.edgeBandSize}px`,
    "--node-border-width": `${config.geometry.nodeBorderWidth}px`,
    "--selected-node-border-width": `${config.geometry.selectedNodeBorderWidth}px`,
    "--control-border-width": `${config.geometry.controlBorderWidth}px`,
    "--navigation-indicator-width": `${config.geometry.navigationIndicatorWidth}px`,
    "--port-border-width": `${config.geometry.portBorderWidth}px`,
    "--slider-thickness": `${config.geometry.sliderThickness}px`,
    "--slider-thumb-size": `${config.geometry.sliderThumbSize}px`,
    "--space-xs": `${config.spacing.xs}px`,
    "--space-sm": `${config.spacing.sm}px`,
    "--space-md": `${config.spacing.md}px`,
    "--space-lg": `${config.spacing.lg}px`,
    "--space-xl": `${config.spacing.xl}px`,
    "--window-gap": `${config.spacing.windowGap}px`,
    "--workspace-padding": `${config.spacing.workspacePadding}px`,
    "--section-spacing": `${config.spacing.sectionSpacing}px`,
    "--navigation-gap": `${config.spacing.navigationGap}px`,
    "--navigation-width": `${config.layout.navigationWidth}px`,
    "--inspector-width": `${config.layout.inspectorWidth}px`,
    "--diagnostics-height": `${config.layout.diagnosticsHeight}px`,
    "--titlebar-height": `${config.layout.titlebarHeight}px`,
    "--toolbar-height": `${config.layout.toolbarHeight}px`,
    "--navigation-item-height": `${config.layout.navigationItemHeight}px`,
    "--node-min-height": `${config.layout.nodeMinHeight}px`,
    "--node-width": `${config.nodes.nodeWidth}px`,
    "--node-padding": `${config.nodes.nodePadding}px`,
    "--grouping-accent-inset": `${config.nodes.groupingAccentInset}px`,
    "--grouping-accent-side-inset": `${config.nodes.groupingAccentSideInset}px`,
    "--grouping-accent-thickness": `${config.nodes.groupingAccentThickness}px`,
    "--thread-width": `${config.nodes.threadWidth}px`,
    "--thread-opacity": config.nodes.threadOpacity,
    "--port-size": `${config.nodes.portSize}px`,
    "--selected-emphasis": config.nodes.selectedEmphasis,
    "--thread-outline-width": `${config.nodes.threadOutlineWidth}px`,
  };
}
