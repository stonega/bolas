import System from 'system';

import { resolveBundledIconFile } from '../src/bundledIcons.js';

const DRAW_TOOL_ICONS = [
  'tool-arrow-symbolic.svg',
  'tool-ellipse-symbolic.svg',
  'tool-line-symbolic.svg',
  'tool-pencil-symbolic.svg',
  'tool-rectangle-symbolic.svg',
  'tool-select-symbolic.svg',
  'tool-text-symbolic.svg',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  for (const filename of DRAW_TOOL_ICONS) {
    const file = resolveBundledIconFile(filename);
    assert(file.query_exists(null), `${filename} is missing`);
    assert(file.query_info('standard::size', 0, null).get_size() > 0, `${filename} is empty`);
    const [loaded, contents] = file.load_contents(null);
    const svg = new TextDecoder().decode(contents);

    assert(loaded, `${filename} could not be read`);
    assert(!svg.includes('stroke='), `${filename} uses unsupported symbolic stroke geometry`);
    assert(svg.includes('fill="#2e3436"'), `${filename} is not a GNOME symbolic icon`);
    if (filename.includes('rectangle') || filename.includes('ellipse'))
      assert(svg.includes('fill-rule="evenodd"'), `${filename} is not outlined`);
  }

  print('bundled draw tool icons are available');
  System.exit(0);
} catch (error) {
  printerr(error.stack ?? error.message);
  System.exit(1);
}
