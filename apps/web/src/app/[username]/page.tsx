import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { ShieldCheck, Database, BookOpen, AlertCircle, Calendar, Hash, Github } from 'lucide-react';
import styles from './page.module.css';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import ProfileRepoListClient from './ProfileRepoListClient';
import CopyAddressClient from './CopyAddressClient';

export default async function PublicProfilePage({ params }: { params: { username: string } }) {
  const session = await getServerSession(authOptions);
  
  // Find user by github username
  const user = await db.findUserByUsername(params.username);

  if (!user) {
    notFound();
  }

  // Check ownership using the stored githubId (which we mapped to email in the demo)
  const isOwner = session?.user?.email === user.githubId;
  
  // Handle Private Profile
  if (!user.isProfilePublic && !isOwner) {
    return (
      <div className={styles.profile_container}>
        <div className={styles.profile_header} style={{ justifyContent: 'center', textAlign: 'center', flexDirection: 'column' }}>
          <ShieldCheck size={48} color="var(--color-text-dim)" style={{ marginBottom: '1rem' }} />
          <h1 className={styles.username}>{params.username}</h1>
          <p style={{ color: 'var(--color-text-dim)', marginTop: '0.5rem' }}>This user's profile is completely private.</p>
        </div>
      </div>
    );
  }

  // Filter repositories based on ownership and repo privacy
  const visibleRepos = isOwner ? user.repositories : user.repositories.filter((r) => !r.isPrivate);

  // Stats calculations
  const totalRepos = visibleRepos.length;
  const securedRepos = visibleRepos.filter(r => r.isBackedUp).length;
  const joinedDate = new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  // Use a generic github avatar URL or the authenticated session image if it's the owner
  const avatarUrl = isOwner && session?.user?.image 
    ? session.user.image 
    : `https://github.com/${params.username}.png`;

  return (
    <div className={styles.profile_container}>
      
      {/* Profile Header */}
      <div className={styles.profile_header}>
        <div className={styles.avatar_wrapper}>
          <img src={avatarUrl} alt={`${params.username}'s avatar`} className={styles.avatar} />
        </div>
        
        <div className={styles.user_info}>
          <h1 className={styles.username}>
            {params.username}
            {securedRepos > 0 && (
              <span title="Secured Developer" style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '12px', background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 'bold' }}>
                <ShieldCheck size={14} style={{ marginRight: '4px' }} />
                Verified
              </span>
            )}
          </h1>
          <CopyAddressClient address={user.ckbAddress} />
          
          {user.bio && (
            <p style={{ marginTop: '8px', color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, maxWidth: '600px' }}>
              {user.bio}
            </p>
          )}
          
          <div className={styles.stats_row} style={{ marginTop: '12px' }}>
            <div className={styles.stat_pill}>
              <ShieldCheck size={14} color="var(--color-success)" />
              <span><span className={styles.stat_value}>{securedRepos}</span> / {totalRepos} Repos Secured</span>
            </div>
            <div className={styles.stat_pill}>
              <Calendar size={14} />
              <span>Joined {joinedDate}</span>
            </div>
          </div>
        </div>
        
        {isOwner && (
          <div style={{ marginLeft: 'auto', alignSelf: 'flex-start' }}>
            <Link href="/settings" className="btn btn--secondary" style={{ padding: '8px 16px' }}>
              Edit Profile
            </Link>
          </div>
        )}
      </div>

      {/* Repositories Section */}
      <div className={styles.repos_section}>
        <h2 className={styles.section_title}>
          <BookOpen size={20} />
          Repositories
        </h2>
        
        {totalRepos === 0 ? (
          <div className={styles.not_found}>
            <BookOpen size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
            <h3>No repositories yet</h3>
            <p>This user hasn't backed up any public repositories.</p>
          </div>
        ) : (
          <ProfileRepoListClient username={params.username} repos={visibleRepos} />
        )}
      </div>
      
    </div>
  );
}
