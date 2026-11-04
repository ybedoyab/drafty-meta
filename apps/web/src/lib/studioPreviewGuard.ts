/**
 * Tracks Scenario studio CAD preview requests so a late response cannot
 * overwrite a newer scenario/spec or leave a busy flag stuck after navigation.
 */
export class StudioPreviewGuard {
  private generation = 0;
  private currentUrl: string | null = null;
  private revokeUrl: (url: string) => void;

  constructor(revokeUrl: (url: string) => void = (url) => URL.revokeObjectURL(url)) {
    this.revokeUrl = revokeUrl;
  }

  /** Start an explicit preview request. Returns the generation token for that request. */
  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  /** Drop the active preview target (spec change, navigation, unmount). */
  invalidate(): void {
    this.generation += 1;
    this.dropCurrent();
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  /**
   * Accept a completed preview blob only if `token` still matches.
   * Stale blobs are revoked immediately and never replace the active URL.
   */
  accept(token: number, url: string): string | null {
    if (!this.isCurrent(token)) {
      this.revokeUrl(url);
      return null;
    }
    this.dropCurrent();
    this.currentUrl = url;
    return url;
  }

  /** Revoke a blob that must not enter state (already known stale at settle time). */
  discard(url: string): void {
    this.revokeUrl(url);
  }

  peekUrl(): string | null {
    return this.currentUrl;
  }

  generationId(): number {
    return this.generation;
  }

  private dropCurrent(): void {
    if (this.currentUrl) {
      this.revokeUrl(this.currentUrl);
      this.currentUrl = null;
    }
  }
}
