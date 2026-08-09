import { IconDefinition } from '@ant-design/icons-angular';
import {
  AimOutline,
  RocketOutline,
  ShareAltOutline,
  ThunderboltOutline,
} from '@ant-design/icons-angular/icons';

/** The icons the app registers, in one place: `provideNzIcons(NZ_ICONS)` in app.config.ts
 *  reads it, and so must any TestBed that renders a component containing an `<nz-icon>`
 *  (otherwise the icon is fetched dynamically, 404s, and the test hangs). */
export const NZ_ICONS: IconDefinition[] = [
  AimOutline,
  RocketOutline,
  ShareAltOutline,
  ThunderboltOutline,
];
