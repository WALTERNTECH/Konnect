import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout, RequireAuth } from "./components/Layout";
import { Empty, LinkButton, Spinner } from "./components/ui";
import { LiveEvents } from "./context/AuthContext";
import Account from "./pages/Account";
import Advertise from "./pages/Advertise";
import { Forgot, Login, Signup, VerifyPhone } from "./pages/Auth";
import Browse from "./pages/Browse";
import Connect, { ConnectProfileView } from "./pages/Connect";
import Home from "./pages/Home";
import Host from "./pages/Host";
import { Privacy, SafetyPage, Terms } from "./pages/Info";
import ListingDetail from "./pages/ListingDetail";
import Membership from "./pages/Membership";
import Messages from "./pages/Messages";
import { TripDetail, Trips } from "./pages/Trips";

const Admin = lazy(() => import("./admin/Admin"));

function NotFound() {
  return (
    <div className="page">
      <Empty title="This page doesn't exist" action={<LinkButton to="/">Go to Konnect</LinkButton>}>
        The link may be old, or the page may have moved.
      </Empty>
    </div>
  );
}

export default function App() {
  return (
    <>
      <LiveEvents />
      <Routes>
        <Route
          path="/admin/*"
          element={
            <Suspense
              fallback={
                <div className="auth">
                  <Spinner />
                </div>
              }
            >
              <Admin />
            </Suspense>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/verify-phone" element={<RequireAuth><VerifyPhone /></RequireAuth>} />
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="stays" element={<Browse key="stays" type="STAY" />} />
          <Route path="wellness" element={<Browse key="wellness" type="WELLNESS" />} />
          <Route path="listings/:id" element={<ListingDetail />} />
          <Route path="membership" element={<Membership />} />
          <Route path="connect" element={<Connect />} />
          <Route path="connect/:userId" element={<RequireAuth><ConnectProfileView /></RequireAuth>} />
          <Route path="messages" element={<RequireAuth><Messages /></RequireAuth>} />
          <Route path="messages/:matchId" element={<RequireAuth><Messages /></RequireAuth>} />
          <Route path="trips" element={<RequireAuth><Trips /></RequireAuth>} />
          <Route path="trips/:id" element={<RequireAuth><TripDetail /></RequireAuth>} />
          <Route path="account/*" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="host/*" element={<Host />} />
          <Route path="advertise" element={<Advertise />} />
          <Route path="safety" element={<SafetyPage />} />
          <Route path="terms" element={<Terms />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}

