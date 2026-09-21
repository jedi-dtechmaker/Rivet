import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Settings, Shield, RefreshCw, Save, User as UserIcon, ArrowLeft, Search, ChevronRight } from 'lucide-react';
import { saveSettings } from './actions';
import styles from './page.module.css';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  
  // @ts-ignore
  const userId = session.user?.id;
  
  if (!session || !userId) {
    redirect('/dashboard');
  }

  const user = await db.findUserByGithubId(userId);
  
  if (!user) {
    redirect('/dashboard');
  }

  return (
    <div className={styles.settings_container}>
      <div className={styles.header}>
        <div className={styles.header__content}>
          <div style={{ marginBottom: '16px' }}>
            <Link 
              href="/dashboard" 
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}
            >
              <ArrowLeft size={16} /> Back to Dashboard
            </Link>
          </div>
          <h1 className={styles.title}>Settings</h1>
        </div>
      </div>

      <div className={styles.search_container}>
        <Search size={18} className={styles.search_icon} />
        <input type="text" placeholder="Search for a setting..." className={styles.search_input} />
      </div>

      <form action={saveSettings} className={styles.form}>
        <input type="hidden" name="ckbAddress" value={user.ckbAddress ?? ''} />
        
        <div className={styles.settings_list}>
          {/* Account */}
          <details className={styles.accordion}>
            <summary className={styles.accordion_summary}>
              <UserIcon size={20} className={styles.summary_icon} />
              <span className={styles.summary_label}>Account</span>
              <ChevronRight size={20} className={styles.chevron_icon} />
            </summary>
            <div className={styles.accordion_content}>
              <label htmlFor="bio" style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: 'var(--color-text-primary)' }}>Profile Bio</label>
              <p className={styles.help_text}>A short bio that appears on your public profile. (Max 160 chars)</p>
              <textarea 
                id="bio"
                name="bio"
                defaultValue={user.bio || ''}
                maxLength={160}
                className={styles.input_field}
                style={{ width: '100%', minHeight: '80px', padding: '12px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontFamily: 'inherit', resize: 'vertical' }}
                placeholder="Software Developer building on CKB..."
              />
            </div>
          </details>

          {/* Privacy & Security */}
          <details className={styles.accordion}>
            <summary className={styles.accordion_summary}>
              <Shield size={20} className={styles.summary_icon} />
              <span className={styles.summary_label}>Privacy & Security</span>
              <ChevronRight size={20} className={styles.chevron_icon} />
            </summary>
            <div className={styles.accordion_content}>
              <div className={styles.toggle_wrapper}>
                <div>
                  <label htmlFor="isProfilePublic" style={{ display: 'block', marginBottom: '4px', fontWeight: 500, color: 'var(--color-text-primary)', cursor: 'pointer' }}>Public Profile</label>
                  <p className={styles.help_text} style={{ margin: 0 }}>Allow anyone to view your public repositories on your profile.</p>
                </div>
                <div style={{ marginLeft: '16px' }}>
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
          </details>

          {/* Sync Settings */}
          <details className={styles.accordion}>
            <summary className={styles.accordion_summary}>
              <RefreshCw size={20} className={styles.summary_icon} />
              <span className={styles.summary_label}>Sync Settings</span>
              <ChevronRight size={20} className={styles.chevron_icon} />
            </summary>
            <div className={styles.accordion_content}>
              <div className={styles.toggle_wrapper}>
                <div>
                  <label htmlFor="autoSync" style={{ display: 'block', marginBottom: '4px', fontWeight: 500, color: 'var(--color-text-primary)', cursor: 'pointer' }}>Auto-Sync Repositories</label>
                  <p className={styles.help_text} style={{ margin: 0 }}>Automatically back up your CKB-secured repositories when you push new commits to GitHub.</p>
                </div>
                <div style={{ marginLeft: '16px' }}>
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
          </details>
        </div>

        <div className={styles.form_actions}>
          <button type="submit" className="btn btn--primary">
            <Save size={16} /> Save Preferences
          </button>
        </div>
      </form>
    </div>
  );
}
