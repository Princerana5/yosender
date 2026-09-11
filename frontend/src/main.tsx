import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Layout from './layout.js';
import Login from './pages/Login.js';
import Dashboard from './pages/Dashboard.js';
import Clients from './pages/Clients.js';
import ClientDetail from './pages/ClientDetail.js';
import Vendors from './pages/Vendors.js';
import Messages from './pages/Messages.js';
import RoutesPage from './pages/Routes.js';
import Billing from './pages/Billing.js';
import { TablePage, Connections, Reports } from './pages/Generic.js';
import Traffic from './pages/Traffic.js';
import { StatusBadge } from './components.js';
import { token } from './api.js';

function Guard({ children }: { children: JSX.Element }): JSX.Element {
  return token() ? children : <Navigate to="/login" replace />;
}

const statusCol = {
  key: 'status',
  label: 'Status',
  render: (r: Record<string, unknown>) => <StatusBadge status={String(r.status ?? 'unknown')} />,
};

const timeCol = (key: string, label: string) => ({
  key,
  label,
  render: (r: Record<string, unknown>) => (
    <span className="text-xs text-muted whitespace-nowrap">
      {r[key] ? new Date(String(r[key])).toLocaleString() : '—'}
    </span>
  ),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Guard><Layout /></Guard>}>
          <Route index element={<Dashboard />} />
          <Route path="traffic" element={<Traffic />} />
          <Route path="clients" element={<Clients />} />
          <Route path="clients/:id" element={<ClientDetail />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="connections" element={<Connections />} />
          <Route path="routes" element={<RoutesPage />} />
          <Route
            path="policies"
            element={
              <TablePage
                title="Traffic policies"
                sub="Sampling & distribution rules · raw vendor DLRs stay immutable"
                endpoint="/routes"
                columns={[
                  { key: 'name', label: 'Route' },
                  { key: 'strategy', label: 'Strategy', mono: true },
                  statusCol,
                ]}
              />
            }
          />
          <Route path="messages" element={<Messages />} />
          <Route
            path="dlr"
            element={
              <TablePage
                title="DLR logs"
                sub="Vendor receipt → client-visible outcome mapping"
                endpoint="/messages/dlr/logs"
                columns={[
                  { key: 'vendor_msg_id', label: 'Vendor ID', mono: true },
                  { key: 'destination', label: 'To', mono: true },
                  {
                    key: 'vendor_status', label: 'Vendor',
                    render: (r) => <StatusBadge status={String(r.vendor_status ?? 'unknown')} />,
                  },
                  {
                    key: 'client_status', label: 'Client',
                    render: (r) => <StatusBadge status={String(r.client_status ?? 'unknown')} />,
                  },
                  timeCol('created_at', 'Time'),
                ]}
              />
            }
          />
          <Route path="billing" element={<Billing />} />
          <Route
            path="rates"
            element={
              <TablePage
                title="Vendor rates"
                sub="Termination cost per vendor"
                endpoint="/vendors"
                columns={[
                  { key: 'name', label: 'Vendor' },
                  { key: 'host', label: 'Host', mono: true },
                  { key: 'tps', label: 'TPS', right: true },
                ]}
              />
            }
          />
          <Route path="reports" element={<Reports />} />
          <Route
            path="senders"
            element={
              <TablePage
                title="Sender IDs"
                sub="Per-client approved / blocked alphas"
                endpoint="/system/senders"
                columns={[
                  { key: 'sender', label: 'Sender', mono: true },
                  statusCol,
                  { key: 'client_id', label: 'Client', mono: true },
                ]}
              />
            }
          />
          <Route
            path="countries"
            element={
              <TablePage
                title="Countries"
                sub="Coverage, calling codes and global kill-switches"
                endpoint="/system/countries"
                columns={[
                  { key: 'name', label: 'Country' },
                  { key: 'iso_code', label: 'ISO', mono: true },
                  { key: 'calling_code', label: 'Code', mono: true },
                  statusCol,
                ]}
              />
            }
          />
          <Route
            path="connectors"
            element={
              <TablePage
                title="Channel connectors"
                sub="WhatsApp / RCS provider integrations"
                endpoint="/connectors"
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'channel', label: 'Channel', mono: true },
                  { key: 'provider', label: 'Provider', mono: true },
                  statusCol,
                ]}
              />
            }
          />
          <Route
            path="audit"
            element={
              <TablePage
                title="Audit logs"
                sub="Every mutating admin action · actor, diff, IP"
                endpoint="/system/audit-logs"
                columns={[
                  { key: 'actor_email', label: 'Actor' },
                  { key: 'action', label: 'Action', mono: true },
                  { key: 'object_type', label: 'Object', mono: true },
                  timeCol('created_at', 'Time'),
                ]}
              />
            }
          />
          <Route
            path="users"
            element={
              <TablePage
                title="Users & roles"
                sub="RBAC: super_admin → read_only"
                endpoint="/system/users"
                columns={[
                  { key: 'email', label: 'Email' },
                  { key: 'role', label: 'Role', mono: true },
                  {
                    key: 'is_active', label: 'Active',
                    render: (r) => <StatusBadge status={r.is_active ? 'active' : 'disabled'} />,
                  },
                ]}
              />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
