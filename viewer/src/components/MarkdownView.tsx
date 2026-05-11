import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openInNewWindow } from "../lib/window";

// Internal SPA routes — anything else is handed to the OS via shell.open.
// We match `/entry/`, `/search`, ... at the start, allowing query/hash to
// follow. Bare `/` is the home page.
const INTERNAL_ROUTE = /^\/($|entry(\/|\?|#|$)|search(\/|\?|#|$)|projects(\/|\?|#|$)|graph(\/|\?|#|$)|stats(\/|\?|#|$)|write(\/|\?|#|$))/;

// Register only the languages we actually care about. Everything else falls
// through to plain-text rendering (no background tokenizer cost).
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import go from "highlight.js/lib/languages/go";
import xml from "highlight.js/lib/languages/xml"; // covers html/xml/jsx markup
import sql from "highlight.js/lib/languages/sql";

const languages = {
  javascript,
  js: javascript,
  jsx: javascript,
  typescript,
  ts: typescript,
  tsx: typescript,
  json,
  bash,
  sh: bash,
  shell: bash,
  zsh: bash,
  python,
  py: python,
  ruby,
  rb: ruby,
  go,
  golang: go,
  html: xml,
  xml,
  sql,
};

interface Props {
  source: string;
  className?: string;
}

export function MarkdownView({ source, className }: Props) {
  const navigate = useNavigate();
  return (
    <div className={["md-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { languages, ignoreMissing: true, detect: false }],
        ]}
        components={{
          // Link handling — three cases:
          //   1. Internal SPA route (`/entry/3`, `/search?q=…`) → React
          //      Router's navigate(), no full page reload.
          //   2. In-page anchor (`#section`) → browser default.
          //   3. Anything else (http(s), file://, mailto:, bare paths) →
          //      OS default handler via Tauri shell. `target="_blank"`
          //      alone either does nothing or pops a stray Tauri window.
          a: ({ href, children, ...rest }) => {
            if (typeof href !== "string" || href.length === 0) {
              return (
                <a href={href} {...rest}>
                  {children}
                </a>
              );
            }
            if (href.startsWith("#")) {
              return (
                <a href={href} {...rest}>
                  {children}
                </a>
              );
            }
            if (INTERNAL_ROUTE.test(href)) {
              // Browser convention: plain click navigates in place;
              // Ctrl/Cmd+click and middle-click open in a fresh window —
              // same as EntryCard so authors of inline entry refs
              // (`[label](/entry/42)` in a body) get the popup workflow
              // for free.
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      void openInNewWindow(href);
                      return;
                    }
                    e.preventDefault();
                    navigate(href);
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      void openInNewWindow(href);
                    }
                  }}
                  {...rest}
                >
                  {children}
                </a>
              );
            }
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  void invoke("open_external", { url: href }).catch((err) =>
                    console.error("open_external failed", err),
                  );
                }}
                {...rest}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
