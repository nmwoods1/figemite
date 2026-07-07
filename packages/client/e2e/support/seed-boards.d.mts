// Hand-written declaration for `seed-boards.mjs` (plain JS — the repo's
// `tsconfig.base.json` doesn't enable `allowJs`, so this file gives
// `interaction.spec.ts` typed access to the seeding helpers without widening
// the project's compiler options just for this one script).

export declare const FIXTURES_ROOT: string;
export declare const BOARDS_ROOT: string;
export declare const SLUGS: string[];

/** Re-copies a single fixture slug's directory into `BOARDS_ROOT`, overwriting whatever is there. Returns the destination path. */
export declare function seedSlug(slug: string): string;

/** Re-seeds every slug in `slugs` (defaults to {@link SLUGS}). */
export declare function seedAll(slugs?: string[]): void;
