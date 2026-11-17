import styles from './Drawer.module.scss';

export function Drawer({ open, children }: { open: boolean; children: React.ReactNode }) {
  return <aside className={open ? styles['drawer--open'] : styles.drawer}>{children}</aside>;
}
