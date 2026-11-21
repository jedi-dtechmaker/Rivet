import styles from './layout.module.css';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {children}
      </div>
    </div>
  );
}
