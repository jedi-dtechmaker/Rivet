import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { Settings, Shield, RefreshCw, Save, User as UserIcon } from 'lucide-react';
import { saveSettings } from './actions';
import styles from './page.module.css';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  
  if (!session || !session.user?.email) {
    redirect('/dashboard');
  }

  // Use the email (githubId in our DB) to find the user
  const user = await db.findFirstUser(); // Because it's a demo with 1 user, or we should find by githubId
  
  // Real implementation:
  // const user = await prisma.user.findUnique({ where: { githubId: session.user.email } });
  
  if (!user || user.githubId !== session.user.email) {
    redirect('/dashboard');
  }

  return (
    <div className={styles.settings_container}>
      <div className={styles.header}>
        <div className={styles.header__content}>
          <h1 className={styles.title}>
            <Settings size={28} style={{ marginRight: '12px', color: 'var(--color-primary)' }} />
            Settings
          </h1>
          <p className={styles.subtitle}>Manage your privacy and sync preferences</p>
        </div>
      </div>

      <div className={styles.card}>
        <form action={saveSettings} className={styles.form}>
          <input type="hidden" name="ckbAddress" value={user.ckbAddress} />
          
          <div className={styles.form_group}>
            <div className={styles.form_label_row} style={{ alignItems: 'flex-start' }}>
              <UserIcon size={20} className={styles.form_icon} style={{ marginTop: '4px' }} />
              <div style={{ flex: 1 }}>
                <label className={styles.label} htmlFor="bio">Profile Bio</label>
                <p className={styles.help_text}>A short bio that appears on your public profile. (Max 160 chars)</p>
                <textarea 
                  id="bio"
                  name="bio"
                  defaultValue={user.bio || ''}
                  maxLength={160}
                  className={styles.input_field}
                  style={{ width: '100%', minHeight: '80px', marginTop: '12px', padding: '12px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontFamily: 'inherit', resize: 'vertical' }}
                  placeholder="Software Developer building on CKB..."
                />
              </div>
            </div>
          </div>

          <hr className={styles.divider} />

          <div className={styles.form_group}>
            <div className={styles.form_label_row}>
              <Shield size={20} className={styles.form_icon} />
              <div>
                <label className={styles.label} htmlFor="isProfilePublic">Public Profile</label>
                <p className={styles.help_text}>Allow anyone to view your public repositories on your profile.</p>
              </div>
              <div className={styles.toggle_wrapper}>
                <input 
                  type="checkbox" 
                  id="isProfilePublic" 
                  name="isProfilePublic" 
                  defaultChecked={user.isProfilePublic} 
                  className={styles.toggle_input}
                />
                <label htmlFor="isProfilePublic" className={styles.toggle_label}></label>
              </div>
            </div>
          </div>

          <hr className={styles.divider} />

          <div className={styles.form_group}>
            <div className={styles.form_label_row}>
              <RefreshCw size={20} className={styles.form_icon} />
              <div>
                <label className={styles.label} htmlFor="autoSync">Auto-Sync Repositories</label>
                <p className={styles.help_text}>Automatically back up your CKB-secured repositories when you push new commits to GitHub.</p>
              </div>
              <div className={styles.toggle_wrapper}>
                <input 
                  type="checkbox" 
                  id="autoSync" 
                  name="autoSync" 
                  defaultChecked={user.autoSync} 
                  className={styles.toggle_input}
                />
                <label htmlFor="autoSync" className={styles.toggle_label}></label>
              </div>
            </div>
          </div>

          <div className={styles.form_actions}>
            <button type="submit" className="btn btn--primary">
              <Save size={16} /> Save Preferences
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
