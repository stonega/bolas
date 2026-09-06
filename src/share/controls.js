import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { BACKGROUND_PRESETS, MIN_BACKGROUND_GRID_COLUMNS, SHARE_RATIOS } from './presets.js';
import { paintShareBackgroundSwatch, shareCanvasSize } from './renderer.js';

function sectionLabel(label) {
  return new Gtk.Label({ css_classes: ['heading'], label, margin_top: 6, xalign: 0 });
}

function clipTopRoundedRectangle(cr, width, height, radius) {
  const corner = Math.min(Math.max(0, radius), width / 2, height);
  cr.newSubPath();
  cr.moveTo(0, height);
  cr.lineTo(0, corner);
  cr.arc(corner, corner, corner, Math.PI, (Math.PI * 3) / 2);
  cr.lineTo(width - corner, 0);
  cr.arc(width - corner, corner, corner, -Math.PI / 2, 0);
  cr.lineTo(width, height);
  cr.closePath();
  cr.clip();
}

function noBackgroundSwatch() {
  const swatch = new Gtk.DrawingArea({ content_height: 42, content_width: 96 });

  swatch.set_draw_func((_area, cr, width, height) => {
    const tileSize = 8;
    cr.save();
    try {
      clipTopRoundedRectangle(cr, width, height, 9);
      for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
          const light = (Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2 === 0;
          cr.setSourceRGB(light ? 0.92 : 0.72, light ? 0.92 : 0.72, light ? 0.92 : 0.72);
          cr.rectangle(x, y, tileSize, tileSize);
          cr.fill();
        }
      }
    } finally {
      cr.restore();
    }
  });
  return swatch;
}

function sliderRow(label, minimum, maximum, step, value, onChange) {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
  box.append(new Gtk.Label({ label, xalign: 0 }));
  const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, minimum, maximum, step);
  scale.set_draw_value(false);
  scale.set_hexpand(true);
  scale.set_value(value);
  scale.connect('value-changed', () => onChange(scale.get_value()));
  box.append(scale);
  return box;
}

export function createShareSettingsControls({
  allowNoBackground = false,
  backgroundEnabled = true,
  onChange,
  onBackgroundEnabledChange,
  outputKind = 'PNG',
  preferences,
  settings,
  sourceHasTransparency = false,
  marginBottom = 20,
  marginEnd = 18,
  marginStart = 18,
  marginTop = 70,
} = {}) {
  const controls = new Gtk.Box({
    margin_bottom: marginBottom,
    margin_end: marginEnd,
    margin_start: marginStart,
    margin_top: marginTop,
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 14,
  });
  const changed = (name, value) => {
    preferences?.rememberShareOption(name, value);
    onChange?.(name, value);
  };

  controls.append(sectionLabel('Background'));
  const presetGrid = new Gtk.FlowBox({
    column_spacing: 8,
    homogeneous: true,
    max_children_per_line: BACKGROUND_PRESETS.length + (allowNoBackground ? 1 : 0),
    min_children_per_line: MIN_BACKGROUND_GRID_COLUMNS,
    orientation: Gtk.Orientation.HORIZONTAL,
    row_spacing: 8,
    selection_mode: Gtk.SelectionMode.NONE,
  });
  let firstPresetButton = null;
  let backgroundIsEnabled = Boolean(backgroundEnabled);
  if (allowNoBackground) {
    const child = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
    child.append(noBackgroundSwatch());
    child.append(new Gtk.Label({ css_classes: ['caption'], label: 'None' }));
    const tile = new Gtk.Overlay({ child });
    tile.add_overlay(
      new Gtk.Box({
        can_target: false,
        css_classes: ['share-preset-selection-frame'],
      }),
    );
    const button = new Gtk.ToggleButton({ child: tile, tooltip_text: 'No background' });
    button.add_css_class('share-preset-button');
    button.set_active(!backgroundIsEnabled);
    button.connect('toggled', () => {
      if (!button.get_active()) return;
      backgroundIsEnabled = false;
      onBackgroundEnabledChange?.(false);
    });
    firstPresetButton = button;
    presetGrid.append(button);
  }
  for (const preset of BACKGROUND_PRESETS) {
    const swatch = new Gtk.DrawingArea({ content_height: 42, content_width: 96 });
    swatch.set_draw_func((_area, cr, width, height) => {
      cr.save();
      try {
        clipTopRoundedRectangle(cr, width, height, 9);
        paintShareBackgroundSwatch(cr, width, height, preset.id);
      } finally {
        cr.restore();
      }
    });
    const child = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
    child.append(swatch);
    child.append(new Gtk.Label({ css_classes: ['caption'], label: preset.name }));
    const tile = new Gtk.Overlay({ child });
    tile.add_overlay(
      new Gtk.Box({
        can_target: false,
        css_classes: ['share-preset-selection-frame'],
      }),
    );
    const button = new Gtk.ToggleButton({
      child: tile,
      tooltip_text: `${preset.name} background`,
    });
    button.add_css_class('share-preset-button');
    if (firstPresetButton) button.set_group(firstPresetButton);
    else firstPresetButton = button;
    button.set_active(backgroundIsEnabled && preset.id === settings.presetId);
    button.connect('toggled', () => {
      if (!button.get_active()) return;
      settings.presetId = preset.id;
      if (!backgroundIsEnabled) {
        backgroundIsEnabled = true;
        onBackgroundEnabledChange?.(true);
      }
      changed('presetId', preset.id);
    });
    presetGrid.append(button);
  }
  controls.append(presetGrid);

  controls.append(sectionLabel('Canvas'));
  const ratios = new Gtk.Box({ css_classes: ['linked'], homogeneous: true });
  let firstRatioButton = null;
  const outputDetails = new Gtk.Label({ css_classes: ['caption', 'dim-label'], xalign: 0 });
  const updateOutputDetails = () => {
    const { width, height } = shareCanvasSize(settings.ratioId);
    outputDetails.set_label(`${width} × ${height} ${outputKind}`);
  };
  for (const ratio of SHARE_RATIOS) {
    const button = new Gtk.ToggleButton({ label: ratio.label, tooltip_text: ratio.id });
    if (firstRatioButton) button.set_group(firstRatioButton);
    else firstRatioButton = button;
    button.set_active(ratio.id === settings.ratioId);
    button.connect('toggled', () => {
      if (!button.get_active()) return;
      settings.ratioId = ratio.id;
      updateOutputDetails();
      changed('ratioId', ratio.id);
    });
    ratios.append(button);
  }
  controls.append(ratios);
  controls.append(outputDetails);
  updateOutputDetails();

  controls.append(
    sliderRow('Padding', 3.5, 22, 0.5, settings.padding * 100, (value) => {
      settings.padding = value / 100;
      changed('padding', settings.padding);
    }),
  );
  const cornerRadiusRow = sliderRow('Corner radius', 0, 96, 2, settings.cornerRadius, (value) => {
    settings.cornerRadius = value;
    changed('cornerRadius', value);
  });
  if (sourceHasTransparency) {
    cornerRadiusRow.set_sensitive(false);
    cornerRadiusRow.set_tooltip_text('The source image already defines its transparent edge');
  }
  controls.append(cornerRadiusRow);

  const shadowStrengthRow = sliderRow(
    'Shadow strength',
    0,
    100,
    5,
    settings.shadowStrength * 100,
    (value) => {
      settings.shadowStrength = value / 100;
      changed('shadowStrength', settings.shadowStrength);
    },
  );
  shadowStrengthRow.set_sensitive(settings.shadow && !sourceHasTransparency);
  if (sourceHasTransparency)
    shadowStrengthRow.set_tooltip_text('The source image already contains transparent edge detail');

  const shadowRow = new Adw.SwitchRow({
    active: settings.shadow,
    sensitive: !sourceHasTransparency,
    subtitle: sourceHasTransparency
      ? 'The source image already contains transparent edge detail'
      : 'Lift the media from the background',
    title: 'Shadow',
  });
  shadowRow.connect('notify::active', () => {
    settings.shadow = shadowRow.get_active();
    shadowStrengthRow.set_sensitive(settings.shadow && !sourceHasTransparency);
    changed('shadow', settings.shadow);
  });
  controls.append(shadowRow);
  controls.append(shadowStrengthRow);

  return controls;
}

export function createShareSettingsSidebar(options = {}) {
  const scroller = new Gtk.ScrolledWindow({
    child: createShareSettingsControls(options),
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    min_content_width: 270,
    propagate_natural_width: true,
  });
  scroller.add_css_class('share-sidebar');
  return scroller;
}
