#!/usr/bin/env python3
"""Print geometry for the live editor's shared layout regions."""

import json

from kerf_rpc import raw


EXPRESSION = r"""
(() => {
  const read = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      background: style.backgroundColor,
      font: style.fontFamily, fontSize: style.fontSize,
      padding: style.padding, gap: style.gap,
    };
  };
  return {
    shell: read('.editor-shell'),
    topbar: read('.editor-topbar'),
    workspace: read('.editor-workspace'),
    rail: read('.editor-rail'),
    railTile: read('.editor-rail .rail-tile'),
    library: read('.editor-library'),
    panelHeader: read('.editor-library .panel-header'),
    libraryCard: read('.editor-library .card, .editor-library .squircle-card'),
    program: read('.editor-program'),
    programHeader: read('.editor-program-header'),
    stage: read('.editor-program-stage'),
    canvas: read('.editor-program-stage canvas'),
    transport: read('.editor-program-transport'),
    inspector: read('.editor-inspector'),
    timeline: read('.editor-timeline'),
    timelineToolbar: read('.editor-timeline-toolbar'),
    trackList: read('.editor-track-list'),
    lanes: read('.editor-timeline-lanes'),
  };
})()
"""


print(json.dumps(raw('debug/eval', {'expression': EXPRESSION}), indent=2))
