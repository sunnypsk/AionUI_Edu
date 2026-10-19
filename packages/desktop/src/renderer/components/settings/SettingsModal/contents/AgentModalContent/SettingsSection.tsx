import { Typography } from '@arco-design/web-react';
import React from 'react';

type Props = { id: string; title: string; description?: string; children: React.ReactNode };

/** Rounded panel card shared with the System settings page (same container classes). */
const SettingsSection: React.FC<Props> = ({ id, title, description, children }) => (
  <section className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px' aria-labelledby={id}>
    <Typography.Title id={id} heading={5} className='!mt-0'>
      {title}
    </Typography.Title>
    {description && <Typography.Paragraph type='secondary'>{description}</Typography.Paragraph>}
    {children}
  </section>
);

export default SettingsSection;
