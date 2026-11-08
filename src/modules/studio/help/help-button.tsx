import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import { Drawer } from '@ui';
import type { StudioGuide } from './guides';

/** One guide's text: a summary, then its sections as lists of points or key tables. */
export function GuideBody({ guide }: { guide: StudioGuide }) {
  const id = useId();
  return (
    <div className="studio-guide">
      <p className="m-0 text-sm text-text">{guide.summary}</p>
      {guide.sections.map((section, index) => (
        <section key={section.heading} className="studio-guide__section" aria-labelledby={`${id}-${index}`}>
          <h4 id={`${id}-${index}`} className="studio-guide__heading stat-label m-0">
            {section.heading}
          </h4>
          {section.points ? (
            <ul className="studio-guide__points m-0 text-sm text-text">
              {section.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : null}
          {section.keys ? (
            <dl className="studio-guide__keys m-0 text-sm">
              {section.keys.map((item) => (
                <div key={item.keys} className="studio-guide__key">
                  <dt>
                    <kbd className="key">{item.keys}</kbd>
                  </dt>
                  <dd className="m-0 text-text">{item.action}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/**
 * The top bar's "?" for the area on screen. The guide opens in a drawer, which keeps focus inside it
 * and gives it back to this button when it closes.
 */
export function StudioHelp({ guide }: { guide: StudioGuide }) {
  const [open, setOpen] = useState(false);
  const label = `Help: ${guide.title}`;
  return (
    <>
      <button type="button" className="topbar-icon studio-help" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <CircleHelp aria-hidden="true" />
      </button>
      {/* The top bar's backdrop filter would hold a fixed drawer inside it; it renders on the body. */}
      {createPortal(
        <Drawer open={open} title={guide.title} eyebrow="Studio guide" onClose={() => setOpen(false)}>
          <GuideBody guide={guide} />
        </Drawer>,
        document.body,
      )}
    </>
  );
}
