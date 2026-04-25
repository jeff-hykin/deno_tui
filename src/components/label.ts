// Copyright 2023 Im-Beast. MIT license.
import { Component, ComponentOptions } from "../component.ts";
import { TextObject, TextRectangle } from "../canvas/text.ts";
import { Computed, Effect, Signal, SignalOfObject } from "../signals/mod.ts";

import { signalify } from "../utils/signals.ts";
import { cropToWidth, textWidth } from "../utils/strings.ts";

/**
 * Type that describes position and size of Label
 * When `width` or `height` isn't set, they gets automatically calculated depending of given value text width and amount of lines
 */
export type LabelRectangle = {
  column: number;
  row: number;
  width?: number;
  height?: number;
};

/** Type that describes text positioning in label */
export interface LabelAlign {
  vertical: "top" | "center" | "bottom";
  horizontal: "left" | "center" | "right";
}

export interface LabelOptions extends Omit<ComponentOptions, "rectangle"> {
  text: string | Signal<string>;
  rectangle: LabelRectangle | SignalOfObject<LabelRectangle>;
  align?: LabelAlign | SignalOfObject<LabelAlign>;
  multiCodePointSupport?: boolean | Signal<boolean>;
  overwriteRectangle?: boolean | Signal<boolean>;
}

/**
 * Component for creating multi-line, non interactive text
 *
 * @example
 * ```ts
 * new Label({
 *  parent: tui,
 *  text: "Hello\nthere"
 *  align: {
 *    horizontal: "center",
 *    vertical: "center",
 *  },
 *  theme: {
 *    base: crayon.magenta,
 *  },
 *  rectangle: {
 *    column: 1,
 *    row: 1,
 *  },
 *  zIndex: 0,
 * });
 * ```
 *
 * If you need to use emojis or other multi codepoint characters set `multiCodePointSupport` property to true.
 * @example
 * ```ts
 * new Label({
 *  ...,
 *  text: "🧡",
 *  multiCodePointCharacter: true,
 * });
 * ```
 * Rectangle properties – `width` and `height` are calculated automatically by default.
 * To overwrite that behaviour set `overwriteRectangle` property to true.
 *
 * @example
 * ```ts
 * new Label({
 *  ...,
 *  text: "1 2 3 cut me",
 *  overwriteRectangle: true,
 *  rectangle: {
 *    column: 1,
 *    row: 1,
 *    width: 6,
 *    height: 1,
 *  },
 * })
 * ```
 */
export class Label extends Component {
  declare drawnObjects: { texts: TextObject[] };

  #valueLines: Signal<string[]>;

  text: Signal<string>;
  align: Signal<LabelAlign>;
  overwriteRectangle: Signal<boolean>;
  multiCodePointSupport: Signal<boolean>;

  constructor(options: LabelOptions) {
    super(options as ComponentOptions);

    this.text = signalify(options.text);
    this.overwriteRectangle = signalify(options.overwriteRectangle ?? false);
    this.multiCodePointSupport = signalify(options.multiCodePointSupport ?? true);
    this.align = signalify(options.align ?? { vertical: "top", horizontal: "left" }, { deepObserve: true });

    this.#valueLines = new Computed(() => this.text.value.split("\n"));

    new Effect(() => {
      const rectangle = this.rectangle.value;
      const overwriteRectangle = this.overwriteRectangle.value;
      const valueLines = this.#valueLines.value;

      if (!overwriteRectangle) {
        rectangle.width = valueLines.reduce((p, c) => Math.max(p, textWidth(c)), 0);
        rectangle.height = valueLines.length;
      }

      const drawnTexts = (this.drawnObjects.texts ??= []).length;

      if (valueLines.length > drawnTexts) {
        this.#fillDrawObjects();
      } else if (valueLines.length < drawnTexts) {
        this.#popUnusedDrawObjects();
      }
    });
  }

  draw(): void {
    super.draw();
    this.drawnObjects.texts ??= [];
    this.#fillDrawObjects();
  }

  #fillDrawObjects(): void {
    if (!this.#valueLines) throw new Error("#valueLines has to be set");

    const { drawnObjects } = this;

    for (let offset = drawnObjects.texts.length; offset < this.#valueLines.peek().length; ++offset) {
      const textRectangle: TextRectangle = { column: 0, row: 0, width: 0 };
      const text = new TextObject({
        canvas: this.tui.canvas,
        view: this.view,
        style: this.style,
        zIndex: this.zIndex,
        multiCodePointSupport: this.multiCodePointSupport,
        value: new Computed(() => {
          // Guard against shrink-then-recompute: if the text now has fewer
          // lines than drawn TextObjects, offset can exceed valueLines.length
          // until #popUnusedDrawObjects runs. cropToWidth would crash on
          // undefined.
          const value = this.#valueLines.value[offset] ?? "";
          const cropped = cropToWidth(value, this.rectangle.value.width);
          // When overwriteRectangle is true, pad each line out to the full
          // rect width with spaces. The TextObject applies the Label's base
          // style to every painted cell, so this makes the Label's bg fill
          // the entire rectangle instead of leaving the right side either
          // un-painted (showing stale pixels) or covered by a lower-z bg
          // that may not match.
          if (!this.overwriteRectangle.value) return cropped;
          const visW = textWidth(cropped);
          const padW = this.rectangle.value.width - visW;
          return padW > 0 ? cropped + " ".repeat(padW) : cropped;
        }),
        rectangle: new Computed(() => {
          const valueLines = this.#valueLines.value;

          const { column, row, width, height } = this.rectangle.value;
          textRectangle.column = column;
          textRectangle.row = row + offset;

          let value = valueLines[offset] ?? "";
          value = cropToWidth(value, width);
          const valueWidth = textWidth(value);

          const { vertical, horizontal } = this.align.value;
          switch (horizontal) {
            case "center":
              textRectangle.column += ~~((width - valueWidth) / 2);
              break;
            case "right":
              textRectangle.column += width - valueWidth;
              break;
          }

          textRectangle.row = row + offset;
          switch (vertical) {
            case "center":
              textRectangle.row += ~~(height / 2 - valueLines.length / 2);
              break;
            case "bottom":
              textRectangle.row += height - valueLines.length;
              break;
          }

          // FIXME: Crop text if necessary

          return textRectangle;
        }),
      });

      drawnObjects.texts[offset] = text;
      text.draw();
    }
  }

  #popUnusedDrawObjects(): void {
    if (!this.#valueLines) throw new Error("#valueLines has to be set");

    for (const text of this.drawnObjects.texts.splice(this.#valueLines.peek().length)) {
      text.erase();
    }
  }
}
