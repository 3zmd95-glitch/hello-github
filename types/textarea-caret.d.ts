/** Types for the tiny untyped `textarea-caret` package (pixel position of a caret inside a textarea). */
declare module "textarea-caret" {
  export default function getCaretCoordinates(
    element: HTMLTextAreaElement | HTMLInputElement,
    position: number,
    options?: { debug?: boolean },
  ): { top: number; left: number; height: number };
}
