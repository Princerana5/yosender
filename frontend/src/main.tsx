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
import { TablePage, Connections, Reports, Traffic } from './pages/Generic.js';
import { token } from './api.js';

function Guard({ children }: { children: JSX.Element }): JSX.Element {
  return token() ? children : <Navigate to="/login" replace />;
}

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
          <Route path="policies" element={<TablePage title="Traffic policies" endpoint="/routes" columns={[
            { key: 'name', label: 'Route' }, { key: 'strategy', label: 'Strategy' }, { key: 'status', label: 'Status' },
          ]} />} />
          <Route path="messages" element={<Messages />} />
          <Route path="dlr" element={<TablePage title="DLR logs" endpoint="/messages/dlr/logs" columns={[
            { key: 'vendor_msg_id', label: 'Vendor ID' }, { key: 'destination', label: 'To' },
            { key: 'vendor_status', label: 'Vendor' }, { key: 'client_status', label: 'Client' },
            { key: 'created_at', label: 'Time' },
          ]} />} />
          <Route path="billing" element={<Billing />} />
          <Route path="rates" element={<TablePage title="Vendor rates" endpoint="/vendors" columns={[
            { key: 'name', label: 'Vendor' }, { key: 'host', label: 'Host' }, { key: 'tps', label: 'TPS' },
          ]} />} />
          <Route path="reports" element={<Reports />} />
          <Route path="senders" element={<TablePage title="Sender IDs" endpoint="/system/senders" columns={[
            { key: 'sender', label: 'Sender' }, { key: 'status', label: 'Status' }, { key: 'client_id', label: 'Client' },
          ]} />} />
          <Route path="countries" element={<TablePage title="Countries" endpoint="/system/countries" columns={[
            { key: 'name', label: 'Country' }, { key: 'iso_code', label: 'ISO' },
            { key: 'calling_code', label: 'Code' }, { key: 'status', label: 'Status' },
          ]} />} />
          <Route path="connectors" element={<TablePage title="Channel connectors" endpoint="/connectors" columns={[
            { key: 'name', label: 'Name' }, { key: 'channel', label: 'Channel' },
            { key: 'provider', label: 'Provider' }, { key: 'status', label: 'Status' },
          ]} />} />
          <Route path="audit" element={<TablePage title="Audit logs" endpoint="/system/audit-logs" columns={[
            { key: 'actor_email', label: 'Actor' }, { key: 'action', label: 'Action' },
            { key: 'object_type', label: 'Object' }, { key: 'created_at', label: 'Time' },
          ]} />} />
          <Route path="users" element={<TablePage title="Users & roles" endpoint="/system/users" columns={[
            { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' },
            { key: 'is_active', label: 'Active' },
          ]} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
