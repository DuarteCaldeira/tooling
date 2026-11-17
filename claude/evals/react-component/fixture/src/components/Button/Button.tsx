import styles from './Button.module.scss';

export function Button({ label }: { label: string }) {
  return <button className={styles.button}>{label}</button>;
}
