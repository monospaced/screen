// The page markup, composed entirely from Set's SSR renderers. Because every
// Set element comes from `renderSet*`, updating @monospaced/set-core flows its
// markup changes straight through here — nothing is hand-copied.
//
// App-specific bits that aren't Set components (the file input, the canvas
// stage) are the only raw HTML. Dynamic attributes (aria-disabled on the
// download link) are set at runtime in main.js.

import {
  renderSetBox,
  renderSetButton,
  renderSetContainer,
  renderSetDivider,
  renderSetHeading,
  renderSetIcon,
  renderSetInline,
  renderSetLightswitch,
  renderSetLink,
  renderSetLogo,
  renderSetPage,
  renderSetRadios,
  renderSetRoot,
  renderSetSidebar,
  renderSetStack,
  renderSetSurface,
  SET_LIGHTSWITCH_STORAGE_KEY,
} from "@monospaced/set-core";

import { AXES } from "./axes.mjs";
import { RATIOS } from "./ratios.mjs";

function sidebar() {
  const header = renderSetBox({
    paddingBlock: "none",
    paddingInline: "sm",
    children: `<a href="/">${renderSetHeading({ size: "md", text: "Screen" })}</a>`,
  });
  const content = renderSetBox({
    background: "panel",
    paddingBlock: "md",
    paddingInline: "md",
    children: renderSetStack({
      gap: "md",
      children:
        renderSetRadios({
          id: "axis",
          name: "axis",
          legend: "Color",
          size: "sm",
          value: AXES[0].key,
          radios: AXES.map(({ key, label }) => ({ label, value: key })),
        }) +
        renderSetRadios({
          id: "ratio",
          name: "ratio",
          legend: "Ratio",
          size: "sm",
          value: "default",
          radios: RATIOS.map(({ key, label }) => ({ label, value: key })),
        }),
    }),
  });
  return renderSetSidebar({
    id: "docs-sidebar",
    aboveNotebook: "persistent",
    buttonSize: "sm",
    header,
    children: content,
  });
}

function toolbar() {
  const left = renderSetInline({
    gap: "sm",
    children:
      sidebar() +
      `<a href="/" style="display: block; margin-block: var(--set-spacing-vertical-250)">${renderSetHeading({ size: "md", text: "Screen" })}</a>`,
  });
  const choose = renderSetButton({
    appearance: "outline",
    size: "sm",
    labelVisibility: "hiddenBelowTablet",
    id: "choose",
    icon: "image",
    label: "Open",
    tone: "neutral",
  });
  const fileInput = `<input type="file" id="file" accept="image/*" />`;
  const download = renderSetLink({
    appearance: "outline",
    size: "sm",
    labelVisibility: "hiddenBelowTablet",
    href: "#",
    download: true,
    id: "dl",
    icon: renderSetIcon({ name: "download", size: "fill" }),
    label: "Download",
    tone: "neutral",
  });
  const right = renderSetInline({
    gap: "xs",
    children:
      choose +
      fileInput +
      download +
      renderSetLightswitch({ appearance: "outline", size: "sm" }),
  });
  return renderSetInline({
    gap: "sm",
    justify: "between",
    children: left + right,
  });
}

function header() {
  return renderSetBox({
    background: "panel",
    paddingBlock: "none",
    paddingInline: "none",
    children: renderSetContainer({
      gutter: "narrow",
      maxInlineSize: "none",
      children: renderSetBox({
        background: "transparent",
        paddingBlock: "2xs",
        paddingInline: "none",
        children: toolbar(),
      }),
    }),
  });
}

function main() {
  return renderSetContainer({
    gutter: "narrow",
    maxInlineSize: "none",
    children: renderSetBox({
      paddingBlock: "md",
      paddingInline: "none",
      children: `<div id="stage"></div>`,
    }),
  });
}

function footer() {
  const divider = renderSetDivider({ tone: "subtle" });
  const logo = `<a href="https://monospaced.com" style="margin-block-end: var(--set-spacing-vertical-400)">${renderSetLogo(
    { size: "sm", tone: "neutral", variant: "graphic", label: "Monospaced" },
  )}</a>`;
  const links = renderSetInline({
    as: "ul",
    align: "end",
    gap: "sm",
    children:
      `<li>${renderSetLink({ size: "md", tone: "neutral", href: "https://github.com/monospaced/screen", label: "GitHub" })}</li>` +
      `<li>${renderSetLink({ size: "md", tone: "neutral", href: "https://set.monospaced.com", label: "Set System" })}</li>` +
      `<li>${renderSetLink({ size: "md", tone: "neutral", href: "https://monospaced.com", label: "Monospaced" })}</li>`,
  });
  return (
    divider +
    renderSetContainer({
      gutter: "narrow",
      maxInlineSize: "none",
      children: renderSetBox({
        paddingBlock: "xs",
        paddingInline: "none",
        children: renderSetInline({
          align: "end",
          gap: "xs",
          justify: "between",
          children: logo + links,
        }),
      }),
    })
  );
}

export function renderApp() {
  // Applies a persisted theme override before first paint (no flash): runs
  // inline as the root's first child, before the lightswitch runtime exists.
  const themeBootstrap = `<script>try{var t=localStorage.getItem(${JSON.stringify(
    SET_LIGHTSWITCH_STORAGE_KEY,
  )});if(t==="light"||t==="dark")document.currentScript.closest(".set").setAttribute("data-set-theme",t)}catch(e){}</script>`;
  return renderSetRoot({
    appRoot: true,
    appOverscrollBehavior: "none",
    brand: "mnsp",
    children:
      themeBootstrap +
      renderSetSurface({
        children: renderSetPage({
          stickyHeader: "always",
          headerBorder: "always",
          headerSize: "sm",
          header: header(),
          children: main(),
          footer: footer(),
        }),
      }),
  });
}
