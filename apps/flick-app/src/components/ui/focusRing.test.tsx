import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';
import { ReactionButton } from './ReactionButton';

// A focus ring that exists on Button but nowhere else is not a focus story.
// These assert the utility is actually reached for, per component.
describe('focus ring coverage', () => {
  it('Chip carries the focus ring', () => {
    const { container } = render(<Chip>ดราม่า</Chip>);
    expect((container.firstElementChild as HTMLElement).className).toContain('focus-ring');
  });

  it('ReactionButton carries the focus ring', () => {
    // ReactionButton's root DOM node is a wrapping <div> (for the optional
    // label below the icon); the focusable element is the nested <button>,
    // so that's what must carry the class — not container.firstElementChild.
    const { container } = render(
      <ReactionButton
        active={false}
        icon="heart"
        activeIcon="heartFilled"
        label="ถูกใจ"
        onClick={() => {}}
      />,
    );
    expect(container.querySelector('button')?.className).toContain('focus-ring');
  });
});
