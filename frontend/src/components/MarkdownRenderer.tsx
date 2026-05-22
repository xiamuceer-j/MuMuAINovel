import { Typography, theme } from 'antd';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

const { Text } = Typography;

interface MarkdownRendererProps {
  content?: string | null;
  compact?: boolean;
}

const isSafeUrl = (url?: string | null) => {
  if (!url) {
    return false;
  }

  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();

  return lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('mailto:')
    || trimmed.startsWith('/')
    || trimmed.startsWith('#');
};

export default function MarkdownRenderer({ content, compact = false }: MarkdownRendererProps) {
  const { token } = theme.useToken();
  const markdown = (content || '').trim();

  const components: Components = {
    a: ({ href, children, ...props }) => {
      const safeHref = isSafeUrl(href) ? href : undefined;
      const isExternal = Boolean(safeHref && /^https?:\/\//i.test(safeHref));

      return (
        <a
          {...props}
          href={safeHref}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer noopener' : undefined}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, ...props }) => {
      const safeSrc = isSafeUrl(src) ? src : undefined;
      if (!safeSrc) {
        return null;
      }

      return (
        <img
          {...props}
          src={safeSrc}
          alt={alt || '公告图片'}
          loading="lazy"
        />
      );
    },
    code: ({ className, children, ...props }) => {
      const languageMatch = /language-([\w-]+)/.exec(className || '');
      const text = String(children).replace(/\n$/, '');
      const isBlock = Boolean(languageMatch) || text.includes('\n');

      if (!isBlock) {
        return <Text code>{children}</Text>;
      }

      return (
        <pre className="announcement-markdown-code">
          {languageMatch && (
            <div className="announcement-markdown-code-lang">
              {languageMatch[1]}
            </div>
          )}
          <code {...props} className={className}>{text}</code>
        </pre>
      );
    },
    table: ({ children, ...props }) => (
      <div className="announcement-markdown-table-wrap">
        <table {...props}>{children}</table>
      </div>
    ),
  };

  return (
    <div className={`announcement-markdown ${compact ? 'announcement-markdown-compact' : ''}`}>
      <style>
        {`
          .announcement-markdown {
            color: ${token.colorText};
            line-height: 1.75;
            word-break: break-word;
          }
          .announcement-markdown > :first-child {
            margin-top: 0 !important;
          }
          .announcement-markdown > :last-child {
            margin-bottom: 0 !important;
          }
          .announcement-markdown p {
            margin: 0 0 ${compact ? 8 : 12}px;
            white-space: pre-wrap;
          }
          .announcement-markdown h1,
          .announcement-markdown h2,
          .announcement-markdown h3,
          .announcement-markdown h4,
          .announcement-markdown h5,
          .announcement-markdown h6 {
            margin: ${compact ? 12 : 18}px 0 ${compact ? 6 : 10}px;
            color: ${token.colorTextHeading};
            font-weight: 600;
            line-height: 1.35;
          }
          .announcement-markdown h1 {
            font-size: ${compact ? 20 : 26}px;
            padding-bottom: 0.3em;
            border-bottom: 1px solid ${token.colorBorderSecondary};
          }
          .announcement-markdown h2 {
            font-size: ${compact ? 18 : 22}px;
            padding-bottom: 0.25em;
            border-bottom: 1px solid ${token.colorBorderSecondary};
          }
          .announcement-markdown h3 {
            font-size: ${compact ? 16 : 18}px;
          }
          .announcement-markdown h4,
          .announcement-markdown h5,
          .announcement-markdown h6 {
            font-size: ${compact ? 14 : 16}px;
          }
          .announcement-markdown ul,
          .announcement-markdown ol {
            padding-left: 1.7em;
            margin: 0 0 ${compact ? 8 : 12}px;
          }
          .announcement-markdown li {
            margin-bottom: 4px;
          }
          .announcement-markdown li > p {
            margin-bottom: 4px;
          }
          .announcement-markdown input[type='checkbox'] {
            margin-right: 6px;
          }
          .announcement-markdown blockquote {
            margin: 0 0 ${compact ? 8 : 12}px;
            padding: 8px 12px;
            border-left: 4px solid ${token.colorPrimary};
            background: ${token.colorFillTertiary};
            border-radius: 8px;
            color: ${token.colorTextSecondary};
          }
          .announcement-markdown blockquote > :last-child {
            margin-bottom: 0;
          }
          .announcement-markdown-code {
            position: relative;
            margin: 0 0 ${compact ? 8 : 12}px;
            padding: ${compact ? '10px 12px' : '14px 16px'};
            overflow: auto;
            border-radius: 10px;
            background: ${token.colorFillQuaternary};
            border: 1px solid ${token.colorBorderSecondary};
          }
          .announcement-markdown pre .announcement-markdown-code {
            margin: 0;
          }
          .announcement-markdown-code code {
            font-family: Consolas, Monaco, 'Courier New', monospace;
            font-size: 13px;
            white-space: pre;
          }
          .announcement-markdown-code-lang {
            margin-bottom: 8px;
            color: ${token.colorTextTertiary};
            font-size: 12px;
          }
          .announcement-markdown :not(pre) > code {
            font-family: Consolas, Monaco, 'Courier New', monospace;
          }
          .announcement-markdown a {
            color: ${token.colorPrimary};
          }
          .announcement-markdown img {
            display: block;
            max-width: 100%;
            max-height: ${compact ? 260 : 420}px;
            margin: 8px 0 ${compact ? 8 : 12}px;
            border-radius: 10px;
            border: 1px solid ${token.colorBorderSecondary};
            object-fit: contain;
          }
          .announcement-markdown hr {
            margin: ${compact ? 12 : 18}px 0;
            border: none;
            border-top: 1px solid ${token.colorBorderSecondary};
          }
          .announcement-markdown del {
            color: ${token.colorTextTertiary};
          }
          .announcement-markdown-table-wrap {
            width: 100%;
            margin: 0 0 ${compact ? 8 : 12}px;
            overflow-x: auto;
          }
          .announcement-markdown table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
          }
          .announcement-markdown th,
          .announcement-markdown td {
            padding: 8px 10px;
            border: 1px solid ${token.colorBorderSecondary};
            text-align: left;
            vertical-align: top;
          }
          .announcement-markdown th {
            background: ${token.colorFillTertiary};
            color: ${token.colorTextHeading};
            font-weight: 600;
          }
          .announcement-markdown tr:nth-child(even) td {
            background: ${token.colorFillQuaternary};
          }
        `}
      </style>
      {markdown ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      ) : (
        <Text type="secondary">暂无内容</Text>
      )}
    </div>
  );
}
