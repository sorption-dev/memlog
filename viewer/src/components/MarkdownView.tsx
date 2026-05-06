import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

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
  return (
    <div className={["md-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { languages, ignoreMissing: true, detect: false }],
        ]}
        components={{
          // External links open in new tab — journal entries may reference docs.
          a: ({ href, children, ...rest }) => {
            const isExternal = typeof href === "string" && /^https?:\/\//.test(href);
            return (
              <a
                href={href}
                {...(isExternal
                  ? { target: "_blank", rel: "noreferrer noopener" }
                  : {})}
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
