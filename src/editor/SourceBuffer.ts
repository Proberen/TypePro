/** Keep the user's exact source until the rendered editor actually changes. */
export class SourceBuffer {
  value: string;
  private rendered: string | null = null;

  constructor(source: string) {
    this.value = source;
  }

  replace(source: string, rendered: string | null = null) {
    this.value = source;
    this.rendered = rendered;
  }

  baseline(rendered: string) {
    this.rendered = rendered;
  }

  accept(rendered: string): boolean {
    if (this.rendered === null || rendered === this.rendered) return false;
    this.rendered = rendered;
    if (rendered === this.value) return false;
    this.value = rendered;
    return true;
  }
}
