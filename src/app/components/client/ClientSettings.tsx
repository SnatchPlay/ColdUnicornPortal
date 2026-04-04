import { useState } from 'react';
import {
  User, Bell, Shield, Globe, Palette, ChevronRight,
  Check, Eye, EyeOff, Save, Camera, Mail, Phone,
  Linkedin, Building2, Clock, AlertCircle, CheckCircle2,
  Moon, Sun, Monitor
} from 'lucide-react';
import { mockUsers, mockClients, mockClientSetup } from '../../data/mock';

const CLIENT_USER = mockUsers.find(u => u.role === 'client')!;
const CLIENT      = mockClients[0];
const SETUP       = mockClientSetup[0];

type SettingsSection = 'profile' | 'notifications' | 'security' | 'preferences';

const SECTIONS: { id: SettingsSection; label: string; icon: typeof User; desc: string }[] = [
  { id: 'profile',       label: 'Profile',       icon: User,    desc: 'Name, contact info, avatar' },
  { id: 'notifications', label: 'Notifications',  icon: Bell,    desc: 'Email & in-app alerts' },
  { id: 'security',      label: 'Security',       icon: Shield,  desc: 'Password, 2FA' },
  { id: 'preferences',   label: 'Preferences',    icon: Globe,   desc: 'Language, timezone, display' },
];

// ── Shared ────────────────────────────────────────────────────

function SaveBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/30 text-green-400 rounded-xl shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
      <CheckCircle2 className="w-4 h-4" />
      <span className="text-sm">Changes saved</span>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-6 space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/60 mt-1">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, disabled, readOnly, icon: Icon }: {
  value: string; onChange?: (v: string) => void; type?: string;
  placeholder?: string; disabled?: boolean; readOnly?: boolean;
  icon?: typeof User;
}) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />}
      <input
        type={type}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        className={`w-full ${Icon ? 'pl-9' : 'pl-3'} pr-3 py-2.5 bg-secondary/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all ${disabled || readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
      />
    </div>
  );
}

function Toggle({ value, onChange, label, desc }: { value: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm">{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative shrink-0 w-10 h-5.5 rounded-full transition-colors mt-0.5 ${value ? 'bg-primary' : 'bg-white/10'}`}
        style={{ height: 22, width: 42 }}
      >
        <span className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`}
          style={{ width: 18, height: 18 }} />
      </button>
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function ProfileSection({ onSave }: { onSave: () => void }) {
  const [name, setName]   = useState(CLIENT_USER.full_name);
  const [email, setEmail] = useState(CLIENT_USER.email);
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [title, setTitle] = useState('Head of Sales');
  const dirty = name !== CLIENT_USER.full_name || phone || linkedin || title !== 'Head of Sales';

  return (
    <div className="space-y-5">
      <SectionCard title="Personal Info" subtitle="Your public-facing profile within the platform">
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center text-white text-xl shrink-0">
              {getInitials(name || CLIENT_USER.full_name)}
            </div>
            <button className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center hover:bg-primary/80 transition-colors">
              <Camera className="w-3 h-3 text-white" />
            </button>
          </div>
          <div>
            <p className="text-sm">{name || CLIENT_USER.full_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Client · {CLIENT.name}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Avatar is auto-generated from initials</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full Name">
            <Input value={name} onChange={setName} placeholder="Your full name" icon={User} />
          </Field>
          <Field label="Job Title">
            <Input value={title} onChange={setTitle} placeholder="e.g. Head of Sales" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email Address" hint="Used for login and notifications">
            <Input value={email} onChange={setEmail} type="email" icon={Mail} />
          </Field>
          <Field label="Phone (optional)">
            <Input value={phone} onChange={setPhone} type="tel" placeholder="+380 ..." icon={Phone} />
          </Field>
        </div>

        <Field label="LinkedIn URL (optional)">
          <Input value={linkedin} onChange={setLinkedin} placeholder="linkedin.com/in/yourprofile" icon={Linkedin} />
        </Field>
      </SectionCard>

      <SectionCard title="Company" subtitle="Read-only — managed by GHEADS">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company Name">
            <Input value={CLIENT.name} readOnly icon={Building2} />
          </Field>
          <Field label="Account Status">
            <div className="flex items-center gap-2 px-3 py-2.5 bg-secondary/30 border border-border rounded-xl">
              <span className={`w-2 h-2 rounded-full ${CLIENT.status === 'active' ? 'bg-green-400' : 'bg-yellow-400'}`} />
              <span className="text-sm capitalize">{CLIENT.status}</span>
            </div>
          </Field>
          <Field label="Contract Due">
            <Input value={CLIENT.contract_due_date ?? '—'} readOnly />
          </Field>
          <Field label="CS Manager">
            <Input value="Alex Kovalenko" readOnly icon={User} />
          </Field>
        </div>
        <div className="flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/15 rounded-xl">
          <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            To update company details or contract terms, contact your GHEADS account manager directly.
          </p>
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <button
          onClick={onSave}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm"
        >
          <Save className="w-4 h-4" />Save Changes
        </button>
      </div>
    </div>
  );
}

function NotificationsSection({ onSave }: { onSave: () => void }) {
  const [prefs, setPrefs] = useState({
    email_new_mql:       true,
    email_meeting:       true,
    email_won:           true,
    email_weekly_report: true,
    email_system:        false,
    inapp_new_mql:       true,
    inapp_meeting:       true,
    inapp_ooo:           false,
  });

  const set = (key: keyof typeof prefs, val: boolean) =>
    setPrefs(p => ({ ...p, [key]: val }));

  return (
    <div className="space-y-5">
      <SectionCard title="Email Notifications" subtitle="Delivered to your registered email address">
        <Toggle value={prefs.email_new_mql}       onChange={v => set('email_new_mql', v)}
          label="New MQL delivered"               desc="Get notified when a new qualified lead arrives" />
        <Toggle value={prefs.email_meeting}        onChange={v => set('email_meeting', v)}
          label="Meeting booked"                   desc="Alert when a prospect agrees to a meeting" />
        <Toggle value={prefs.email_won}            onChange={v => set('email_won', v)}
          label="Deal won"                         desc="Celebrate a closed deal" />
        <Toggle value={prefs.email_weekly_report}  onChange={v => set('email_weekly_report', v)}
          label="Weekly performance report"        desc="Every Monday morning summary" />
        <Toggle value={prefs.email_system}         onChange={v => set('email_system', v)}
          label="System & maintenance notices"     desc="Downtime, updates, billing" />
      </SectionCard>

      <SectionCard title="In-App Notifications" subtitle="Shown inside the platform">
        <Toggle value={prefs.inapp_new_mql}  onChange={v => set('inapp_new_mql', v)}
          label="New MQL banner"              desc="Real-time toast when a lead qualifies" />
        <Toggle value={prefs.inapp_meeting}  onChange={v => set('inapp_meeting', v)}
          label="Meeting scheduled"           desc="Notification when meeting is confirmed" />
        <Toggle value={prefs.inapp_ooo}      onChange={v => set('inapp_ooo', v)}
          label="OOO leads returned"          desc="Alert when an OOO prospect return date passes" />
      </SectionCard>

      <div className="flex justify-end">
        <button onClick={onSave}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm">
          <Save className="w-4 h-4" />Save Preferences
        </button>
      </div>
    </div>
  );
}

function SecuritySection({ onSave }: { onSave: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurr, setShowCurr] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [twofa, setTwofa]     = useState(false);

  const strength = next.length === 0 ? 0 : next.length < 8 ? 1 : next.length < 12 ? 2 : /[A-Z]/.test(next) && /[0-9]/.test(next) ? 4 : 3;
  const matchOk  = next.length > 0 && next === confirm;
  const canSave  = current.length >= 4 && next.length >= 8 && matchOk;

  const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const strengthColors = ['', 'bg-red-500', 'bg-yellow-500', 'bg-blue-400', 'bg-green-500'];

  function PasswordInput({ value, show, onShow, onChange, placeholder }: {
    value: string; show: boolean; onShow: () => void; onChange: (v: string) => void; placeholder: string;
  }) {
    return (
      <div className="relative">
        <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-10 py-2.5 bg-secondary/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all" />
        <button type="button" onClick={onShow} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard title="Change Password" subtitle="Minimum 8 characters, mix of letters and numbers recommended">
        <Field label="Current Password">
          <PasswordInput value={current} show={showCurr} onShow={() => setShowCurr(!showCurr)}
            onChange={setCurrent} placeholder="Enter current password" />
        </Field>
        <Field label="New Password">
          <PasswordInput value={next} show={showNext} onShow={() => setShowNext(!showNext)}
            onChange={setNext} placeholder="Min 8 characters" />
          {next.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="flex gap-1">
                {[1,2,3,4].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? strengthColors[strength] : 'bg-white/10'}`} />
                ))}
              </div>
              <p className={`text-xs ${strengthColors[strength].replace('bg-', 'text-')}`}>{strengthLabels[strength]}</p>
            </div>
          )}
        </Field>
        <Field label="Confirm New Password">
          <div className="relative">
            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              className={`w-full pl-9 pr-10 py-2.5 bg-secondary/30 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${
                confirm.length > 0 ? (matchOk ? 'border-green-500/40' : 'border-red-500/40') : 'border-border'
              }`} />
            {confirm.length > 0 && (
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 ${matchOk ? 'text-green-400' : 'text-red-400'}`}>
                {matchOk ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              </span>
            )}
          </div>
        </Field>
        <div className="flex justify-end">
          <button onClick={onSave} disabled={!canSave}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed">
            <Save className="w-4 h-4" />Update Password
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Two-Factor Authentication" subtitle="Add an extra layer of security">
        <Toggle value={twofa} onChange={setTwofa}
          label="Enable 2FA via Authenticator App"
          desc="Requires TOTP code on every login (Google Authenticator, Authy)" />
        {twofa && (
          <div className="flex items-start gap-2 p-3 bg-yellow-500/5 border border-yellow-500/15 rounded-xl">
            <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              2FA setup requires contacting your GHEADS account manager. This toggle is a preference indicator.
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Active Sessions" subtitle="Devices currently logged in">
        {[
          { device: 'Chrome · macOS', location: 'Kyiv, UA', time: 'Now', current: true },
          { device: 'Safari · iPhone', location: 'Kyiv, UA', time: '2h ago', current: false },
        ].map((s, i) => (
          <div key={i} className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm">{s.device}</p>
              <p className="text-xs text-muted-foreground">{s.location} · {s.time}</p>
            </div>
            {s.current
              ? <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg">Current</span>
              : <button className="text-xs text-red-400 hover:text-red-300 transition-colors">Revoke</button>
            }
          </div>
        ))}
      </SectionCard>
    </div>
  );
}

function PreferencesSection({ onSave }: { onSave: () => void }) {
  const [lang, setLang]       = useState('en');
  const [tz, setTz]           = useState('Europe/Kyiv');
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [theme, setTheme]     = useState<'dark' | 'light' | 'system'>('dark');

  const THEMES: { id: typeof theme; label: string; icon: typeof Moon }[] = [
    { id: 'dark',   label: 'Dark',   icon: Moon },
    { id: 'light',  label: 'Light',  icon: Sun },
    { id: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="space-y-5">
      <SectionCard title="Display" subtitle="Visual preferences for the platform">
        <Field label="Theme">
          <div className="flex gap-2">
            {THEMES.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setTheme(t.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${
                    theme === t.id ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:border-primary/20'
                  }`}>
                  <Icon className="w-4 h-4" />{t.label}
                  {theme === t.id && <Check className="w-3.5 h-3.5" />}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-1.5">Platform currently runs in dark mode only. Light mode coming soon.</p>
        </Field>

        <Field label="Date Format">
          <div className="flex gap-2 flex-wrap">
            {['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map(f => (
              <button key={f} onClick={() => setDateFormat(f)}
                className={`px-3 py-2 rounded-xl border text-xs transition-all ${
                  dateFormat === f ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:border-primary/20'
                }`}>{f}</button>
            ))}
          </div>
        </Field>
      </SectionCard>

      <SectionCard title="Localization" subtitle="Language and time settings">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Language">
            <select value={lang} onChange={e => setLang(e.target.value)}
              className="w-full px-3 py-2.5 bg-secondary/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
              <option value="en">English</option>
              <option value="uk">Українська</option>
              <option value="pl">Polski</option>
              <option value="de">Deutsch</option>
            </select>
          </Field>

          <Field label="Timezone">
            <select value={tz} onChange={e => setTz(e.target.value)}
              className="w-full px-3 py-2.5 bg-secondary/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
              <option value="Europe/Kyiv">Europe/Kyiv (UTC+3)</option>
              <option value="Europe/Warsaw">Europe/Warsaw (UTC+2)</option>
              <option value="Europe/Berlin">Europe/Berlin (UTC+2)</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New_York (UTC-5)</option>
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-2 p-3 bg-white/3 border border-border/50 rounded-xl text-xs text-muted-foreground">
          <Clock className="w-4 h-4 shrink-0" />
          Current time in {tz.split('/')[1] ?? tz}: {new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <button onClick={onSave}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm">
          <Save className="w-4 h-4" />Save Preferences
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export function ClientSettings() {
  const [section, setSection] = useState<SettingsSection>('profile');
  const [saved, setSaved]     = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, notifications and preferences</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar nav */}
        <aside className="lg:w-56 shrink-0">
          <div className="bg-card border border-border rounded-xl overflow-hidden lg:sticky lg:top-6">
            {SECTIONS.map((s, i) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button key={s.id} onClick={() => setSection(s.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors border-b last:border-b-0 border-border/50 ${
                    active ? 'bg-primary/8 text-primary' : 'text-muted-foreground hover:bg-white/4 hover:text-foreground'
                  }`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{s.label}</p>
                    <p className="text-xs text-muted-foreground truncate hidden lg:block">{s.desc}</p>
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform shrink-0 ${active ? 'translate-x-0.5 text-primary' : 'opacity-30'}`} />
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {section === 'profile'       && <ProfileSection       onSave={handleSave} />}
          {section === 'notifications' && <NotificationsSection onSave={handleSave} />}
          {section === 'security'      && <SecuritySection      onSave={handleSave} />}
          {section === 'preferences'   && <PreferencesSection   onSave={handleSave} />}
        </div>
      </div>

      <SaveBanner show={saved} />
    </div>
  );
}
