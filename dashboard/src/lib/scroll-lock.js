/** Keep iOS touch scrolling on the panel and restore the page at its original position. */
export function lockPageScroll(view = window, page = document) {
  const { scrollX, scrollY } = view;
  const { body, documentElement: html } = page;
  const properties = [
    [body.style, 'position', 'fixed'],
    [body.style, 'top', `-${scrollY}px`],
    [body.style, 'left', `-${scrollX}px`],
    [body.style, 'width', '100%'],
    [html.style, 'overflow', 'hidden'],
    [html.style, 'scroll-behavior', 'auto'],
  ];
  const previous = properties.map(([style, name]) => [
    style, name, style.getPropertyValue(name), style.getPropertyPriority(name),
  ]);
  const alreadyOpen = html.classList.contains('conversation-open');
  html.classList.add('conversation-open');
  for (const [style, name, value] of properties) style.setProperty(name, value);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Keep scroll-behavior:auto until the saved position has been restored.
    for (const [style, name, value, priority] of previous.slice(0, -1))
      if (value) style.setProperty(name, value, priority);
      else style.removeProperty(name);
    if (!alreadyOpen) html.classList.remove('conversation-open');
    view.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    const [style, name, value, priority] = previous.at(-1);
    if (value) style.setProperty(name, value, priority);
    else style.removeProperty(name);
  };
}
