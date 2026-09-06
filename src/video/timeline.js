import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { normalizeVideoEdit, videoTimeLabel } from './edit.js';

const RULER_HEIGHT = 30;
const LANE_HEIGHT = 43;
const TRACK_INSET = 20;
const EDGE_HIT_WIDTH = 10;
const KEYBOARD_RESIZE_STEP_US = 100_000;

const LANES = Object.freeze([
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'speed', label: 'Speed' },
  { id: 'text', label: 'Text' },
  { id: 'mask', label: 'Masks' },
]);

const COLORS = Object.freeze({
  audio: '#176c66',
  audioBorder: '#31a89d',
  background: '#0c0e11',
  border: '#282c32',
  effect: '#253d75',
  effectBorder: '#3f68bd',
  grid: '#1c2025',
  muted: '#383d44',
  playhead: '#f3f4f6',
  text: '#f0f2f5',
  textDim: '#747b84',
  video: '#6b521b',
  videoBorder: '#c89b35',
});

function color(cr, hex, alpha = 1) {
  const value = Number.parseInt(hex.slice(1), 16);
  cr.setSourceRGBA(
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
    alpha,
  );
}

function roundedRectangle(cr, x, y, width, height, radius = 7) {
  const corner = Math.min(radius, width / 2, height / 2);
  cr.newSubPath();
  cr.arc(x + width - corner, y + corner, corner, -Math.PI / 2, 0);
  cr.arc(x + width - corner, y + height - corner, corner, 0, Math.PI / 2);
  cr.arc(x + corner, y + height - corner, corner, Math.PI / 2, Math.PI);
  cr.arc(x + corner, y + corner, corner, Math.PI, (Math.PI * 3) / 2);
  cr.closePath();
}

function text(cr, value, x, y, size = 12, strong = false, tint = COLORS.text) {
  color(cr, tint);
  cr.selectFontFace('sans-serif', 0, strong ? 1 : 0);
  cr.setFontSize(size);
  cr.moveTo(x, y);
  cr.showText(String(value));
}

function majorTickSeconds(durationUs) {
  const seconds = durationUs / 1_000_000;
  if (seconds <= 15) return 1;
  if (seconds <= 60) return 5;
  if (seconds <= 180) return 15;
  if (seconds <= 600) return 30;
  return 60;
}

export const VideoTimeline = GObject.registerClass(
  {
    GTypeName: 'BolasVideoTimeline',
    Signals: {
      'lane-activated': {
        param_types: [GObject.TYPE_STRING, GObject.TYPE_DOUBLE],
      },
      'seek-requested': {
        param_types: [GObject.TYPE_DOUBLE],
      },
      'segment-selected': {
        param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING],
      },
      'segment-resize-requested': {
        param_types: [
          GObject.TYPE_STRING,
          GObject.TYPE_STRING,
          GObject.TYPE_STRING,
          GObject.TYPE_DOUBLE,
        ],
      },
      'trim-requested': {
        param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE],
      },
    },
  },
  class VideoTimeline extends Gtk.DrawingArea {
    _init() {
      super._init({
        accessible_role: Gtk.AccessibleRole.GROUP,
        content_height: RULER_HEIGHT + LANE_HEIGHT * LANES.length + 10,
        content_width: 960,
        focusable: true,
        hexpand: true,
      });
      this.update_property([Gtk.AccessibleProperty.LABEL], ['Video and audio editing timeline']);
      this._durationUs = 0;
      this._timestampUs = 0;
      this._edit = normalizeVideoEdit();
      this._selectedKind = '';
      this._selectedId = '';
      this._dragMode = '';
      this._dragStartUs = 0;
      this._dragBlock = null;
      this._dragEdge = '';
      this.set_draw_func((_area, cr, width, height) => this._draw(cr, width, height));
      this._updateAccessibleDescription();
      this.connect('notify::has-focus', () => this.queue_draw());

      const click = new Gtk.GestureClick({ button: Gdk.BUTTON_PRIMARY });
      click.connect('pressed', (_gesture, presses, x, y) => this._pressed(presses, x, y));
      this.add_controller(click);

      const drag = new Gtk.GestureDrag({ button: Gdk.BUTTON_PRIMARY });
      drag.connect('drag-begin', (_gesture, x, y) => this._dragBegin(x, y));
      drag.connect('drag-update', (_gesture, offsetX) => this._dragUpdate(offsetX));
      drag.connect('drag-end', (_gesture, offsetX) => {
        this._dragUpdate(offsetX);
        this._dragMode = '';
        this._dragBlock = null;
        this._dragEdge = '';
      });
      this.add_controller(drag);

      const motion = new Gtk.EventControllerMotion();
      motion.connect('motion', (_controller, x, y) => this._updateCursor(x, y));
      motion.connect('leave', () => this.set_cursor_from_name('default'));
      this.add_controller(motion);

      const key = new Gtk.EventControllerKey();
      key.connect('key-pressed', (_controller, keyval, _keycode, state) =>
        this._keyPressed(keyval, state),
      );
      this.add_controller(key);
    }

    setTimeline(durationUs, edit, timestampUs) {
      this._durationUs = Math.max(0, Number(durationUs) || 0);
      this._edit = normalizeVideoEdit(edit, this._durationUs);
      this._timestampUs = Math.min(this._durationUs, Math.max(0, Number(timestampUs) || 0));
      this._updateAccessibleDescription();
      this.queue_draw();
    }

    setTimestamp(timestampUs) {
      const timestamp = Math.min(this._durationUs, Math.max(0, Number(timestampUs) || 0));
      if (timestamp === this._timestampUs) return;
      this._timestampUs = timestamp;
      this.queue_draw();
    }

    setSelected(kind = '', id = '') {
      this._selectedKind = String(kind);
      this._selectedId = String(id);
      this._updateAccessibleDescription();
      this.queue_draw();
    }

    _trackWidth(width) {
      return Math.max(1, width - TRACK_INSET * 2);
    }

    _timeToX(timestampUs, width) {
      if (this._durationUs <= 0) return TRACK_INSET;
      return TRACK_INSET + (timestampUs / this._durationUs) * this._trackWidth(width);
    }

    _xToTime(x, width) {
      const progress = Math.min(1, Math.max(0, (x - TRACK_INSET) / this._trackWidth(width)));
      return Math.round(progress * this._durationUs);
    }

    _laneAt(y) {
      const index = Math.floor((y - RULER_HEIGHT) / LANE_HEIGHT);
      return LANES[index]?.id ?? 'ruler';
    }

    _laneY(laneId) {
      return RULER_HEIGHT + LANES.findIndex((lane) => lane.id === laneId) * LANE_HEIGHT;
    }

    _blocksForLane(lane) {
      if (lane === 'video')
        return [
          {
            endUs: this._edit.trimEndUs,
            id: 'video',
            kind: 'video',
            startUs: this._edit.trimStartUs,
          },
        ];
      if (lane === 'audio')
        return [
          {
            endUs: this._edit.trimEndUs,
            id: 'audio',
            kind: 'audio',
            startUs: this._edit.trimStartUs,
          },
        ];
      if (lane === 'speed')
        return Math.abs(this._edit.speed - 1) > 1e-9
          ? [
              {
                endUs: this._edit.trimEndUs,
                id: 'speed',
                kind: 'speed',
                startUs: this._edit.trimStartUs,
              },
            ]
          : [];
      const segments =
        lane === 'zoom'
          ? this._edit.zoomSegments
          : lane === 'text'
            ? this._edit.captions
            : lane === 'mask'
              ? this._edit.masks
              : [];
      return segments.map((segment) => ({ ...segment, kind: lane }));
    }

    _orderedBlocks() {
      return LANES.flatMap((lane) => this._blocksForLane(lane.id));
    }

    _isSelected(block) {
      return block?.kind === this._selectedKind && block?.id === this._selectedId;
    }

    _selectedBlock() {
      return this._orderedBlocks().find((block) => this._isSelected(block)) ?? null;
    }

    _blockAt(lane, timestampUs) {
      return (
        this._blocksForLane(lane)
          .sort((left, right) => Number(this._isSelected(right)) - Number(this._isSelected(left)))
          .find((block) => timestampUs >= block.startUs && timestampUs <= block.endUs) ?? null
      );
    }

    _edgeAt(lane, x, width) {
      const candidates = [];
      for (const block of this._blocksForLane(lane)) {
        for (const edge of ['start', 'end']) {
          const edgeX = this._timeToX(block[`${edge}Us`], width);
          const distance = Math.abs(x - edgeX);
          if (distance <= EDGE_HIT_WIDTH) candidates.push({ block, distance, edge });
        }
      }
      candidates.sort(
        (left, right) =>
          left.distance - right.distance ||
          Number(this._isSelected(right.block)) - Number(this._isSelected(left.block)),
      );
      return candidates[0] ?? null;
    }

    _selectBlock(block) {
      if (!block) {
        this.setSelected();
        this.emit('segment-selected', '', '');
        return;
      }
      this.setSelected(block.kind, block.id);
      this.emit('segment-selected', block.kind, block.id);
    }

    _blockLabel(block) {
      if (block.kind === 'video') return 'Video clip';
      if (block.kind === 'audio') return 'Audio';
      if (block.kind === 'zoom') return 'Zoom';
      if (block.kind === 'speed') return 'Speed';
      if (block.kind === 'text') return 'Text';
      return 'Blur region';
    }

    _updateAccessibleDescription() {
      const block = this._selectedBlock();
      const description = block
        ? `${this._blockLabel(block)} selected, ${videoTimeLabel(block.startUs)} to ${videoTimeLabel(block.endUs)}. Drag either edge to resize. Shift plus Left or Right changes the end; Control plus Shift changes the start.`
        : 'Click a block to select it and drag either edge to change its duration. Use Up and Down to select blocks with the keyboard.';
      this.update_property([Gtk.AccessibleProperty.DESCRIPTION], [description]);
    }

    _cycleSelection(direction) {
      const blocks = this._orderedBlocks();
      if (!blocks.length) return false;
      const current = blocks.findIndex((block) => this._isSelected(block));
      const next =
        current < 0
          ? direction > 0
            ? 0
            : blocks.length - 1
          : (current + direction + blocks.length) % blocks.length;
      this._selectBlock(blocks[next]);
      return true;
    }

    _emitBlockResize(block, edge, timestampUs) {
      if (['video', 'audio', 'speed'].includes(block.kind)) {
        this.emit(
          'trim-requested',
          edge === 'start' ? timestampUs : block.startUs,
          edge === 'end' ? timestampUs : block.endUs,
        );
        return;
      }
      this.emit('segment-resize-requested', block.kind, block.id, edge, timestampUs);
    }

    _keyPressed(keyval, state) {
      const shift = (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
      const control = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
      if (!shift && keyval === Gdk.KEY_Up) return this._cycleSelection(-1);
      if (!shift && keyval === Gdk.KEY_Down) return this._cycleSelection(1);
      if (!shift || (keyval !== Gdk.KEY_Left && keyval !== Gdk.KEY_Right)) return false;

      const block = this._selectedBlock();
      if (!block) return false;
      const edge = control ? 'start' : 'end';
      const direction = keyval === Gdk.KEY_Left ? -1 : 1;
      this._emitBlockResize(block, edge, block[`${edge}Us`] + direction * KEYBOARD_RESIZE_STEP_US);
      return true;
    }

    _updateCursor(x, y) {
      if (!this._durationUs) {
        this.set_cursor_from_name('default');
        return;
      }
      const lane = this._laneAt(y);
      const edge = this._edgeAt(lane, x, this.get_width());
      const block = edge ?? this._blockAt(lane, this._xToTime(x, this.get_width()));
      this.set_cursor_from_name(edge ? 'ew-resize' : block ? 'pointer' : 'default');
    }

    _draw(cr, width, height) {
      color(cr, COLORS.background);
      cr.paint();
      if (!this._durationUs) {
        text(cr, 'Loading timeline…', TRACK_INSET, 54, 13, false, COLORS.textDim);
        return;
      }

      const majorSeconds = majorTickSeconds(this._durationUs);
      const durationSeconds = this._durationUs / 1_000_000;
      for (let second = 0; second <= durationSeconds + majorSeconds; second += majorSeconds) {
        const timestamp = Math.min(this._durationUs, second * 1_000_000);
        const x = this._timeToX(timestamp, width);
        color(cr, COLORS.grid);
        cr.setLineWidth(1);
        cr.moveTo(x, 0);
        cr.lineTo(x, height);
        cr.stroke();
        if (second > 0 && timestamp < this._durationUs + 1)
          text(
            cr,
            videoTimeLabel(timestamp).replace('.0', ''),
            x - 13,
            17,
            10,
            false,
            COLORS.textDim,
          );
      }

      for (let index = 0; index < LANES.length; index++) {
        const y = RULER_HEIGHT + index * LANE_HEIGHT;
        color(cr, index % 2 === 0 ? '#101318' : '#0e1115');
        roundedRectangle(cr, TRACK_INSET, y + 3, this._trackWidth(width), LANE_HEIGHT - 6, 6);
        cr.fill();
      }

      this._drawClip(cr, width);
      this._drawAudio(cr, width);
      this._drawSegments(cr, width, 'zoom', this._edit.zoomSegments, (segment) =>
        segment.source === 'input'
          ? `${segment.scale.toFixed(1)}×  Input focus`
          : `${segment.scale.toFixed(1)}×  ${segment.mode === 'manual' ? 'Point' : 'Center'}`,
      );
      if (Math.abs(this._edit.speed - 1) > 1e-9)
        this._drawSegments(
          cr,
          width,
          'speed',
          [{ id: 'speed', startUs: this._edit.trimStartUs, endUs: this._edit.trimEndUs }],
          () => `${this._edit.speed}× pace`,
        );
      else this._drawHint(cr, 'speed', 'Speed — double-click to change pace (S)');
      this._drawSegments(cr, width, 'text', this._edit.captions, (segment) => segment.text);
      if (!this._edit.captions.length)
        this._drawHint(cr, 'text', 'Text — double-click to add a caption (T)');
      this._drawSegments(cr, width, 'mask', this._edit.masks, () => 'Blur region');
      if (!this._edit.masks.length)
        this._drawHint(cr, 'mask', 'Masks — double-click to blur a region (M)');
      if (!this._edit.zoomSegments.length)
        this._drawHint(cr, 'zoom', 'Zoom — double-click to add focus (Z)');

      const playheadX = this._timeToX(this._timestampUs, width);
      color(cr, COLORS.playhead);
      cr.setLineWidth(1.5);
      cr.moveTo(playheadX, 19);
      cr.lineTo(playheadX, height);
      cr.stroke();
      cr.moveTo(playheadX - 7, 18);
      cr.lineTo(playheadX + 7, 18);
      cr.lineTo(playheadX, 27);
      cr.closePath();
      cr.fill();

      if (this.has_focus) {
        color(cr, COLORS.playhead, 0.72);
        cr.setLineWidth(1.5);
        roundedRectangle(cr, 1, 1, width - 2, height - 2, 8);
        cr.stroke();
      }
    }

    _drawEdgeHandles(cr, startX, endX, y, tint, selected = false) {
      color(cr, selected ? COLORS.playhead : tint, selected ? 1 : 0.78);
      roundedRectangle(cr, startX - 2, y + 4, 4, LANE_HEIGHT - 18, 2);
      roundedRectangle(cr, endX - 2, y + 4, 4, LANE_HEIGHT - 18, 2);
      cr.fill();
    }

    _drawClip(cr, width) {
      const y = this._laneY('video') + 5;
      const startX = this._timeToX(this._edit.trimStartUs, width);
      const endX = this._timeToX(this._edit.trimEndUs, width);
      const selected = this._selectedKind === 'video' && this._selectedId === 'video';
      color(cr, COLORS.video);
      roundedRectangle(cr, startX, y, Math.max(4, endX - startX), LANE_HEIGHT - 10, 7);
      cr.fillPreserve();
      color(cr, COLORS.videoBorder);
      cr.setLineWidth(selected ? 2.8 : 1.5);
      cr.stroke();
      text(cr, '▣  Video clip', startX + 10, y + 16, 12, true);
      text(
        cr,
        `${videoTimeLabel(this._edit.trimEndUs - this._edit.trimStartUs)}  ·  ${this._edit.speed}×`,
        startX + 10,
        y + 31,
        10,
        false,
        '#d7c79e',
      );
      this._drawEdgeHandles(cr, startX, endX, y, '#e8c56b', selected);
    }

    _drawAudio(cr, width) {
      const y = this._laneY('audio') + 5;
      const startX = this._timeToX(this._edit.trimStartUs, width);
      const endX = this._timeToX(this._edit.trimEndUs, width);
      const selected = this._selectedKind === 'audio' && this._selectedId === 'audio';
      color(cr, this._edit.muted ? COLORS.muted : COLORS.audio);
      roundedRectangle(cr, startX, y, Math.max(4, endX - startX), LANE_HEIGHT - 10, 7);
      cr.fillPreserve();
      color(cr, this._edit.muted ? '#626972' : COLORS.audioBorder);
      cr.setLineWidth(selected ? 2.8 : 1.2);
      cr.stroke();
      const available = Math.max(0, endX - startX - 154);
      const ticks = Math.floor(available / 13);
      color(cr, this._edit.muted ? '#737981' : '#6bc9c0', 0.65);
      for (let index = 0; index < ticks; index++) {
        const x = startX + 145 + index * 13;
        const amplitude = 4 + ((index * 7) % 12);
        cr.rectangle(x, y + (LANE_HEIGHT - 10 - amplitude) / 2, 2, amplitude);
      }
      cr.fill();
      text(cr, '♫  Audio', startX + 10, y + 17, 12, true);
      text(
        cr,
        this._edit.muted ? 'Muted' : `${Math.round(this._edit.audioVolume * 100)}% volume`,
        startX + 10,
        y + 31,
        10,
        false,
        this._edit.muted ? '#b0b4ba' : '#9adbd5',
      );
      this._drawEdgeHandles(
        cr,
        startX,
        endX,
        y,
        this._edit.muted ? '#9298a0' : '#72d7cd',
        selected,
      );
    }

    _drawSegments(cr, width, lane, segments, labelFor) {
      const y = this._laneY(lane) + 5;
      for (const segment of segments) {
        const startX = this._timeToX(segment.startUs, width);
        const endX = this._timeToX(segment.endUs, width);
        const selected = this._selectedKind === lane && this._selectedId === segment.id;
        color(cr, COLORS.effect);
        roundedRectangle(cr, startX, y, Math.max(3, endX - startX), LANE_HEIGHT - 10, 7);
        cr.fillPreserve();
        color(cr, COLORS.effectBorder);
        cr.setLineWidth(selected ? 2.8 : 1.2);
        cr.stroke();
        const label = String(labelFor(segment));
        text(
          cr,
          label.slice(0, Math.max(4, Math.floor((endX - startX) / 7))),
          startX + 9,
          y + 23,
          11,
          true,
        );
        this._drawEdgeHandles(cr, startX, endX, y, '#6f92df', selected);
      }
    }

    _drawHint(cr, lane, label) {
      text(cr, label, TRACK_INSET + 10, this._laneY(lane) + 27, 11, false, COLORS.textDim);
    }

    _pressed(presses, x, y) {
      if (!this._durationUs) return;
      this.grab_focus();
      const width = this.get_width();
      const timestampUs = this._xToTime(x, width);
      const lane = this._laneAt(y);
      const edge = this._edgeAt(lane, x, width);
      this._selectBlock(edge?.block ?? this._blockAt(lane, timestampUs));
      this.emit('seek-requested', timestampUs);
      if (presses >= 2 && lane !== 'ruler') this.emit('lane-activated', lane, timestampUs);
    }

    _dragBegin(x, y) {
      if (!this._durationUs) return;
      const width = this.get_width();
      const edge = this._edgeAt(this._laneAt(y), x, width);
      if (edge) {
        this._dragMode = 'resize';
        this._dragBlock = edge.block;
        this._dragEdge = edge.edge;
        this._dragStartUs = edge.block[`${edge.edge}Us`];
        this._selectBlock(edge.block);
        return;
      }
      this._dragMode = 'playhead';
      this._dragStartUs = this._xToTime(x, width);
    }

    _dragUpdate(offsetX) {
      if (!this._dragMode || !this._durationUs) return;
      const offsetUs = (offsetX / this._trackWidth(this.get_width())) * this._durationUs;
      const timestampUs = Math.round(
        Math.min(this._durationUs, Math.max(0, this._dragStartUs + offsetUs)),
      );
      if (this._dragMode === 'resize' && this._dragBlock)
        this._emitBlockResize(this._dragBlock, this._dragEdge, timestampUs);
      else this.emit('seek-requested', timestampUs);
    }
  },
);
