import { Injectable } from '@angular/core';

/** A table as the export writes it: a header and rows of positional values. */
export interface BundleTable {
  table: string;
  columns: string[];
  rows: unknown[][];
}

/** The part of the manifest the UI reads. It is normative: refuse a schema we do not know. */
export interface BundleManifest {
  schema_version: number;
  generated_at: string;
  target_season: string;
  input_season: string;
  heavy_seasons: string[];
  sheet_revision?: number;
}

const KNOWN_SCHEMA = 1;

/** Reads the toolkit's export bundle. The app has no other data source: no scraping, no DB. */
@Injectable({ providedIn: 'root' })
export class Bundle {
  private readonly base = 'data';
  private readonly cache = new Map<string, Promise<BundleTable>>();
  private manifestPromise?: Promise<BundleManifest>;

  manifest(): Promise<BundleManifest> {
    this.manifestPromise ??= fetch(`${this.base}/manifest.json`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            `manifest.json non trovato (${res.status}). Lancia "npm run data:pull" dopo un export del toolkit.`,
          );
        }
        return res.json() as Promise<BundleManifest>;
      })
      .then((manifest) => {
        if (manifest.schema_version !== KNOWN_SCHEMA) {
          throw new Error(
            `Bundle schema_version ${manifest.schema_version}: questa app conosce solo la ${KNOWN_SCHEMA}.`,
          );
        }
        return manifest;
      });
    return this.manifestPromise;
  }

  table(name: string): Promise<BundleTable> {
    let pending = this.cache.get(name);
    if (!pending) {
      pending = this.load(name);
      this.cache.set(name, pending);
    }
    return pending;
  }

  private async load(name: string): Promise<BundleTable> {
    const res = await fetch(`${this.base}/${name}.json.gz`);
    if (!res.ok) {
      throw new Error(`Tabella "${name}" non disponibile nel bundle (${res.status}).`);
    }
    const raw = new Uint8Array(await res.arrayBuffer());
    // Whether the bytes are still gzipped depends on the server: some set Content-Encoding
    // and the fetch layer has already inflated them. Sniff the magic number instead of
    // assuming - assuming is how this breaks in production and not in dev.
    const gzipped = raw[0] === 0x1f && raw[1] === 0x8b;
    const text = gzipped
      ? await new Response(
          new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).text()
      : new TextDecoder().decode(raw);
    return JSON.parse(text) as BundleTable;
  }
}

/** Positional access without materialising an object per row: 110k rows go through here. */
export function columnIndex(table: BundleTable, ...names: string[]): number[] {
  return names.map((name) => {
    const at = table.columns.indexOf(name);
    if (at < 0) throw new Error(`La tabella "${table.table}" non ha la colonna "${name}".`);
    return at;
  });
}
