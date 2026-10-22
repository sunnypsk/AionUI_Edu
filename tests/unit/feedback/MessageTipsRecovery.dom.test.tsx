import type { IMessageTips } from '@/common/chat/chatLib';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/components/Markdown', () => ({ default: () => null }));
vi.mock('@renderer/components/base/ButlerDiagnoseButton', () => ({ default: () => null }));
vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import MessageTips from '@/renderer/pages/conversation/Messages/components/MessageTips';

const tip = (code: string): IMessageTips => ({
  id: 'restart-tip',
  msg_id: 'restart-tip',
  conversation_id: 'conversation',
  type: 'tips',
  position: 'left',
  content: { type: 'warning', code, content: 'Interrupted' },
});

describe('interrupted turn continuation', () => {
  it('waits for a click and only prepares an editable prompt', () => {
    emit.mockClear();
    render(<MessageTips message={tip('TURN_INTERRUPTED_BY_RESTART')} />);
    expect(emit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    expect(emit.mock.calls).toEqual([
      ['sendbox.fill', 'conversation.agentTip.codes.TURN_INTERRUPTED_BY_RESTART.continuePrompt'],
    ]);
  });

  it('does not offer continuation for unrelated warnings', () => {
    render(<MessageTips message={tip('OTHER_WARNING')} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
