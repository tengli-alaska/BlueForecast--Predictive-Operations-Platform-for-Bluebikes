"""
BlueForecast — Station-Level Operations Dashboard
Contributor: Ankit Tiwari
Place this file in: dashboard/app.py
Run with: streamlit run dashboard/app.py
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime, timedelta
import math

# ─── Page Config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="BlueForecast | Operations",
    page_icon="🚲",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Theme & CSS ──────────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');

:root {
    --blue:   #0057FF;
    --red:    #FF3B30;
    --green:  #34C759;
    --amber:  #FF9F0A;
    --bg:     #F2F5FB;
    --card:   #FFFFFF;
    --border: #DDE3F0;
    --text:   #0A0E1A;
    --muted:  #6B7594;
    --mono:   'DM Mono', monospace;
}

html, body, [class*="css"] {
    font-family: 'DM Sans', sans-serif;
    background-color: var(--bg) !important;
    color: var(--text);
}
#MainMenu, footer, header { visibility: hidden; }
.block-container { padding: 1.4rem 2rem 3rem 2rem !important; max-width: 1380px; }

/* ── Top header ── */
.bf-header {
    display: flex; align-items: flex-end; gap: 16px;
    padding-bottom: 1rem;
    border-bottom: 2.5px solid var(--blue);
    margin-bottom: 1.6rem;
}
.bf-logo { font-family: 'Syne', sans-serif; font-size: 1.9rem; font-weight: 800;
           color: var(--blue); letter-spacing: -1px; line-height: 1; }
.bf-tag  { font-family: var(--mono); font-size: 0.68rem; color: var(--muted);
           text-transform: uppercase; letter-spacing: 0.1em; padding-bottom: 3px; }
.bf-live { display:inline-flex; align-items:center; gap:5px; background:#E8FEEF;
           border: 1px solid var(--green); border-radius: 20px;
           padding: 2px 10px; font-size: 0.7rem; font-family: var(--mono);
           color: var(--green); margin-left: auto; }
.bf-live::before { content:''; width:7px; height:7px; border-radius:50%;
                   background:var(--green); animation: pulse 1.6s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

/* ── KPI cards ── */
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 1.6rem; }
.kpi-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px 20px;
    display: flex; flex-direction: column; gap: 4px;
    box-shadow: 0 1px 4px rgba(0,0,0,.05);
}
.kpi-label { font-family: var(--mono); font-size: 0.65rem; color: var(--muted);
             text-transform: uppercase; letter-spacing: 0.09em; }
.kpi-value { font-family: 'Syne', sans-serif; font-size: 2rem; font-weight: 700;
             letter-spacing: -1px; line-height: 1.1; }
.kpi-sub   { font-size: 0.75rem; color: var(--muted); }
.kpi-red   { color: var(--red); }
.kpi-green { color: var(--green); }
.kpi-amber { color: var(--amber); }
.kpi-blue  { color: var(--blue); }

/* ── Section headers ── */
.sec-head { font-family: 'Syne', sans-serif; font-size: 1.05rem; font-weight: 700;
            letter-spacing: -0.3px; margin: 0 0 0.8rem 0; color: var(--text); }
.sec-mono { font-family: var(--mono); font-size: 0.65rem; color: var(--muted);
            text-transform: uppercase; letter-spacing: 0.08em; }

/* ── Alert badges ── */
.badge-critical { background:#FFF0EF; color:var(--red);   border:1px solid #FFCCC9;
                  border-radius:6px; padding:2px 8px; font-size:0.7rem; font-family:var(--mono); font-weight:500; }
.badge-warning  { background:#FFF8EC; color:var(--amber); border:1px solid #FFE4A8;
                  border-radius:6px; padding:2px 8px; font-size:0.7rem; font-family:var(--mono); font-weight:500; }
.badge-ok       { background:#EEFAF3; color:var(--green); border:1px solid #B3ECCC;
                  border-radius:6px; padding:2px 8px; font-size:0.7rem; font-family:var(--mono); font-weight:500; }

/* ── Sidebar ── */
[data-testid="stSidebar"] {
    background: var(--card) !important;
    border-right: 1px solid var(--border) !important;
}
[data-testid="stSidebar"] .block-container { padding: 1.2rem 1rem !important; }

/* ── Plotly chart container ── */
.chart-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px 20px;
    box-shadow: 0 1px 4px rgba(0,0,0,.05);
    margin-bottom: 1rem;
}

/* ── Alert table rows ── */
.alert-row {
    display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
    align-items:center; padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 0.83rem;
}
.alert-row:last-child { border-bottom: none; }
.alert-row:hover { background: #F8F9FD; }
.alert-head { font-family:var(--mono); font-size:0.63rem; color:var(--muted);
              text-transform:uppercase; letter-spacing:0.08em; }
</style>
""", unsafe_allow_html=True)


# ─── Synthetic Data Generator ─────────────────────────────────────────────────
# Replace these functions with real GCS / parquet / API calls when integrating.

@st.cache_data(ttl=300)
def load_stations():
    """Simulate ~595 Bluebikes stations with Boston-area coordinates."""
    np.random.seed(42)
    n = 120  # representative subset for demo
    boston_lat, boston_lon = 42.360, -71.058

    names = [
        "MIT at Mass Ave / Amherst St", "Charles Circle - Charles St at Cambridge St",
        "Kenmore Sq / Commonwealth Ave", "South Station - 700 Atlantic Ave",
        "Boylston St / Arlington St", "Harvard Sq - Mass Ave / Bow St",
        "Fenway at Yawkey", "Copley Sq - Dartmouth St at Boylston",
        "Newbury St / Gloucester St", "Back Bay - Dartmouth St",
        "East Berkeley St / Washington St", "Lechmere Station - Cambridge St",
        "Union Sq - Somerville Ave", "Central Sq - Massachusetts Ave",
        "Porter Sq - Somerville Ave", "Davis Sq - Holland St",
        "Northeastern - Forsyth St", "Symphony Rd at Massachusetts Ave",
        "Prudential Center - Belvidere St", "Prudential - Huntington Ave",
    ]

    rows = []
    for i in range(n):
        lat = boston_lat + np.random.normal(0, 0.025)
        lon = boston_lon + np.random.normal(0, 0.035)
        cap = np.random.choice([11, 15, 19, 23, 27, 31], p=[0.1, 0.25, 0.3, 0.2, 0.1, 0.05])
        docks_available = np.random.randint(0, cap + 1)
        bikes_available = cap - docks_available
        name = names[i % len(names)] if i < len(names) else f"Station {100 + i}"
        rows.append({
            "station_id": f"S{100 + i}",
            "name": name,
            "lat": lat, "lon": lon,
            "capacity": cap,
            "bikes_available": bikes_available,
            "docks_available": docks_available,
            "predicted_demand_1h": max(0, round(np.random.exponential(3.5))),
            "predicted_demand_6h": max(0, round(np.random.exponential(14))),
            "predicted_demand_24h": max(0, round(np.random.exponential(45))),
            "district": np.random.choice(
                ["Back Bay", "Fenway", "Cambridge", "South End", "Somerville", "Downtown", "East Boston"],
                p=[0.15, 0.15, 0.2, 0.15, 0.1, 0.15, 0.1]
            ),
        })
    df = pd.DataFrame(rows)

    # Rebalancing urgency: bikes critically low or high relative to capacity
    df["fill_pct"] = df["bikes_available"] / df["capacity"]
    df["urgency"] = df["fill_pct"].apply(
        lambda x: "Critical" if x < 0.1 or x > 0.9 else ("Warning" if x < 0.2 or x > 0.8 else "OK")
    )
    df["action"] = df.apply(
        lambda r: "⚠ ADD BIKES" if r["fill_pct"] < 0.15
        else ("⚠ REMOVE BIKES" if r["fill_pct"] > 0.85 else "✓ Balanced"),
        axis=1
    )
    return df


@st.cache_data(ttl=300)
def load_hourly_forecast(station_id: str):
    """Simulate 48-hour ahead forecast for a station (XGBoost vs actuals)."""
    np.random.seed(hash(station_id) % 2**31)
    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    hours = [now + timedelta(hours=h) for h in range(-24, 25)]

    base = 3 + 4 * np.abs(np.sin(np.pi * np.arange(49) / 12))  # diurnal pattern
    xgb_pred = np.clip(base + np.random.normal(0, 0.6, 49), 0, None).round(1)
    actuals_full = np.concatenate([
        np.clip(xgb_pred[:24] + np.random.normal(0, 0.8, 24), 0, None).round(1),
        np.full(25, np.nan)
    ])
    actuals = np.where(np.arange(49) < 24, actuals_full, np.nan)

    return pd.DataFrame({
        "datetime": hours,
        "xgb_forecast": xgb_pred,
        "actual": actuals,
        "lower_ci": np.clip(xgb_pred - 1.2, 0, None),
        "upper_ci": xgb_pred + 1.2,
    })


@st.cache_data(ttl=600)
def load_system_metrics():
    """System-level KPIs."""
    return {
        "total_stations": 595,
        "active_stations": 581,
        "critical_alerts": 14,
        "warning_alerts": 31,
        "fleet_utilization": 63.4,
        "model_mae": 2.1,
        "model_rmse": 3.4,
        "drift_status": "Stable",
        "last_retrain": "2024-12-18 03:00 EST",
        "predictions_today": "57,120",
    }


@st.cache_data(ttl=600)
def load_demand_heatmap():
    """Hourly demand by day-of-week × hour for the past 30 days."""
    np.random.seed(7)
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    hours = list(range(24))
    data = []
    for d, day in enumerate(days):
        for h in hours:
            # Commute peaks on weekdays, leisure on weekends
            if d < 5:
                base = 8 if (7 <= h <= 9 or 17 <= h <= 19) else (3 if 10 <= h <= 16 else 1)
            else:
                base = 5 if 10 <= h <= 18 else 2
            data.append({"day": day, "hour": h, "demand": base + np.random.normal(0, 0.5)})
    return pd.DataFrame(data)


# ─── Load data ────────────────────────────────────────────────────────────────
stations = load_stations()
metrics  = load_system_metrics()

# ─── Sidebar ──────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown('<p class="sec-mono">Filters</p>', unsafe_allow_html=True)

    districts = ["All Districts"] + sorted(stations["district"].unique().tolist())
    selected_district = st.selectbox("District", districts)

    urgency_filter = st.multiselect(
        "Alert Level",
        ["Critical", "Warning", "OK"],
        default=["Critical", "Warning", "OK"]
    )

    st.markdown("---")
    st.markdown('<p class="sec-mono">Station Explorer</p>', unsafe_allow_html=True)

    filtered = stations.copy()
    if selected_district != "All Districts":
        filtered = filtered[filtered["district"] == selected_district]
    filtered = filtered[filtered["urgency"].isin(urgency_filter)]

    station_names = filtered["name"].tolist()
    selected_station_name = st.selectbox("Select Station", station_names if station_names else ["No stations match"])

    if station_names:
        sel = filtered[filtered["name"] == selected_station_name].iloc[0]

    st.markdown("---")
    st.markdown(f"""
    <p class="sec-mono">Model Info</p>
    <div style="font-size:0.75rem; line-height:1.8; color:var(--muted);">
    <b style="color:var(--text)">Model</b>&nbsp;&nbsp;XGBoost<br>
    <b style="color:var(--text)">MAE</b>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{metrics['model_mae']} trips/hr<br>
    <b style="color:var(--text)">RMSE</b>&nbsp;&nbsp;&nbsp;&nbsp;{metrics['model_rmse']}<br>
    <b style="color:var(--text)">Drift</b>&nbsp;&nbsp;&nbsp;&nbsp;{metrics['drift_status']}<br>
    <b style="color:var(--text)">Retrained</b><br>{metrics['last_retrain']}
    </div>
    """, unsafe_allow_html=True)


# ─── Header ───────────────────────────────────────────────────────────────────
now_str = datetime.now().strftime("%a %b %d, %Y  %H:%M EST")
st.markdown(f"""
<div class="bf-header">
  <div>
    <div class="bf-logo">🚲 BlueForecast</div>
    <div class="bf-tag">Predictive Operations Platform · Bluebikes Boston</div>
  </div>
  <div style="margin-left:auto; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
    <div class="bf-live">LIVE SIMULATION</div>
    <div style="font-family:var(--mono); font-size:0.65rem; color:var(--muted);">{now_str}</div>
  </div>
</div>
""", unsafe_allow_html=True)


# ─── KPI Row ──────────────────────────────────────────────────────────────────
st.markdown(f"""
<div class="kpi-row">
  <div class="kpi-card">
    <div class="kpi-label">Active Stations</div>
    <div class="kpi-value kpi-blue">{metrics['active_stations']}</div>
    <div class="kpi-sub">of {metrics['total_stations']} total</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">Critical Alerts</div>
    <div class="kpi-value kpi-red">{metrics['critical_alerts']}</div>
    <div class="kpi-sub">stations need immediate action</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">Fleet Utilization</div>
    <div class="kpi-value kpi-amber">{metrics['fleet_utilization']}%</div>
    <div class="kpi-sub">bikes currently in use</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">Predictions Today</div>
    <div class="kpi-value kpi-green">{metrics['predictions_today']}</div>
    <div class="kpi-sub">XGBoost · 595 stations × 96 slots</div>
  </div>
</div>
""", unsafe_allow_html=True)


# ─── Row 1: Map + Station Detail ──────────────────────────────────────────────
col_map, col_detail = st.columns([1.6, 1], gap="medium")

with col_map:
    st.markdown('<p class="sec-head">🗺 Station Map — Predicted Demand (Next Hour)</p>', unsafe_allow_html=True)

    display_df = filtered if len(filtered) > 0 else stations

    color_map = {"Critical": "#FF3B30", "Warning": "#FF9F0A", "OK": "#34C759"}
    display_df = display_df.copy()
    display_df["color"] = display_df["urgency"].map(color_map)
    display_df["size"]  = display_df["predicted_demand_1h"].clip(1, 20) * 1.8 + 5

    fig_map = go.Figure()

    for urgency, color in color_map.items():
        sub = display_df[display_df["urgency"] == urgency]
        if sub.empty:
            continue
        fig_map.add_trace(go.Scattermapbox(
            lat=sub["lat"], lon=sub["lon"],
            mode="markers",
            marker=dict(size=sub["size"], color=color, opacity=0.82, sizemode="diameter"),
            text=sub.apply(lambda r: (
                f"<b>{r['name']}</b><br>"
                f"Bikes: {r['bikes_available']} / {r['capacity']}<br>"
                f"Predicted 1h: {r['predicted_demand_1h']} trips<br>"
                f"Status: {r['urgency']} · {r['action']}"
            ), axis=1),
            hovertemplate="%{text}<extra></extra>",
            name=urgency,
        ))

    fig_map.update_layout(
        mapbox=dict(style="carto-positron", center=dict(lat=42.360, lon=-71.062), zoom=12),
        margin=dict(l=0, r=0, t=0, b=0),
        height=400,
        legend=dict(
            orientation="h", yanchor="bottom", y=0.01, xanchor="left", x=0.01,
            bgcolor="rgba(255,255,255,0.85)", bordercolor="#DDE3F0", borderwidth=1,
            font=dict(size=11)
        ),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )
    st.plotly_chart(fig_map, use_container_width=True, config={"displayModeBar": False})


with col_detail:
    if station_names:
        fill_pct = int(sel["fill_pct"] * 100)
        urgency_class = {
            "Critical": "kpi-red", "Warning": "kpi-amber", "OK": "kpi-green"
        }[sel["urgency"]]

        st.markdown(f'<p class="sec-head">📍 {sel["name"]}</p>', unsafe_allow_html=True)
        st.markdown(f"""
        <div style="background:var(--card); border:1px solid var(--border); border-radius:12px;
                    padding:18px 20px; box-shadow:0 1px 4px rgba(0,0,0,.05);">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
            <div>
              <div class="kpi-label">Bikes Available</div>
              <div style="font-family:'Syne',sans-serif; font-size:1.6rem; font-weight:700;">{sel['bikes_available']}</div>
            </div>
            <div>
              <div class="kpi-label">Capacity</div>
              <div style="font-family:'Syne',sans-serif; font-size:1.6rem; font-weight:700;">{sel['capacity']}</div>
            </div>
            <div>
              <div class="kpi-label">Pred. Demand 1h</div>
              <div style="font-family:'Syne',sans-serif; font-size:1.6rem; font-weight:700; color:var(--blue);">{sel['predicted_demand_1h']}</div>
            </div>
            <div>
              <div class="kpi-label">Pred. Demand 6h</div>
              <div style="font-family:'Syne',sans-serif; font-size:1.6rem; font-weight:700; color:var(--blue);">{sel['predicted_demand_6h']}</div>
            </div>
          </div>

          <div style="margin-bottom:10px;">
            <div class="kpi-label" style="margin-bottom:5px;">Fill Level</div>
            <div style="background:#EEF1F8; border-radius:6px; height:10px; overflow:hidden;">
              <div style="height:100%; width:{fill_pct}%; background:{'var(--red)' if fill_pct < 15 or fill_pct > 85 else 'var(--amber)' if fill_pct < 25 or fill_pct > 75 else 'var(--green)'}; border-radius:6px; transition:width .4s;"></div>
            </div>
            <div style="font-family:var(--mono); font-size:0.7rem; color:var(--muted); margin-top:3px;">{fill_pct}% full · {sel['docks_available']} docks open</div>
          </div>

          <div style="display:flex; align-items:center; gap:8px; margin-top:12px; padding:10px 14px;
                      border-radius:8px; background:{'#FFF0EF' if sel['urgency']=='Critical' else '#FFF8EC' if sel['urgency']=='Warning' else '#EEFAF3'};
                      border:1px solid {'#FFCCC9' if sel['urgency']=='Critical' else '#FFE4A8' if sel['urgency']=='Warning' else '#B3ECCC'};">
            <div style="font-size:1.2rem;">{'🚨' if sel['urgency']=='Critical' else '⚠️' if sel['urgency']=='Warning' else '✅'}</div>
            <div>
              <div style="font-family:'Syne',sans-serif; font-size:0.85rem; font-weight:700;
                          color:{'var(--red)' if sel['urgency']=='Critical' else 'var(--amber)' if sel['urgency']=='Warning' else 'var(--green)'};">
                {sel['urgency']} · {sel['action']}
              </div>
              <div style="font-size:0.72rem; color:var(--muted);">District: {sel['district']}</div>
            </div>
          </div>
        </div>
        """, unsafe_allow_html=True)


# ─── Row 2: Forecast Chart + Heatmap ──────────────────────────────────────────
col_fc, col_hm = st.columns([1.5, 1], gap="medium")

with col_fc:
    st.markdown('<p class="sec-head">📈 48-Hour Demand Forecast</p>', unsafe_allow_html=True)

    if station_names:
        fc = load_hourly_forecast(sel["station_id"])
        now_idx = 24

        fig_fc = go.Figure()

        # CI band
        fig_fc.add_trace(go.Scatter(
            x=pd.concat([fc["datetime"], fc["datetime"][::-1]]),
            y=pd.concat([fc["upper_ci"], fc["lower_ci"][::-1]]),
            fill="toself", fillcolor="rgba(0,87,255,0.08)",
            line=dict(color="rgba(0,0,0,0)"),
            hoverinfo="skip", name="95% CI"
        ))

        # XGBoost forecast
        fig_fc.add_trace(go.Scatter(
            x=fc["datetime"], y=fc["xgb_forecast"],
            mode="lines", line=dict(color="#0057FF", width=2.5),
            name="XGBoost Forecast"
        ))

        # Actuals (past 24h only)
        actual_df = fc.dropna(subset=["actual"])
        fig_fc.add_trace(go.Scatter(
            x=actual_df["datetime"], y=actual_df["actual"],
            mode="lines+markers",
            line=dict(color="#0A0E1A", width=1.5, dash="dot"),
            marker=dict(size=4, color="#0A0E1A"),
            name="Actual"
        ))



        fig_fc.update_layout(
            height=320,
            margin=dict(l=10, r=10, t=10, b=10),
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            xaxis=dict(showgrid=False, tickfont=dict(size=10, family="DM Mono"),
                       tickformat="%a %H:%M", nticks=10),
            yaxis=dict(showgrid=True, gridcolor="#EEF1F8",
                       title=dict(text="Trips / Hour", font=dict(size=11)),
                       tickfont=dict(size=10, family="DM Mono"), zeroline=False),
            legend=dict(orientation="h", y=-0.18, font=dict(size=11)),
            font=dict(family="DM Sans"),
        )
        st.plotly_chart(fig_fc, use_container_width=True, config={"displayModeBar": False})


with col_hm:
    st.markdown('<p class="sec-head">🔥 Demand Heatmap (30-day avg)</p>', unsafe_allow_html=True)

    hm_df = load_demand_heatmap()
    hm_pivot = hm_df.pivot(index="day", columns="hour", values="demand")
    day_order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    hm_pivot = hm_pivot.reindex(day_order)

    fig_hm = go.Figure(go.Heatmap(
        z=hm_pivot.values,
        x=[f"{h:02d}:00" for h in range(24)],
        y=day_order,
        colorscale=[
            [0.0,  "#EEF1F8"],
            [0.3,  "#BFCFFF"],
            [0.6,  "#5E8DFF"],
            [0.85, "#0057FF"],
            [1.0,  "#003299"],
        ],
        showscale=True,
        colorbar=dict(thickness=12, len=0.9, tickfont=dict(size=9, family="DM Mono")),
        hovertemplate="<b>%{y} %{x}</b><br>Avg demand: %{z:.1f} trips<extra></extra>",
    ))

    fig_hm.update_layout(
        height=320,
        margin=dict(l=10, r=10, t=10, b=10),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        xaxis=dict(tickfont=dict(size=9, family="DM Mono"), tickangle=-45, nticks=12),
        yaxis=dict(tickfont=dict(size=10, family="DM Mono")),
        font=dict(family="DM Sans"),
    )
    st.plotly_chart(fig_hm, use_container_width=True, config={"displayModeBar": False})


# ─── Row 3: Rebalancing Alerts Table ──────────────────────────────────────────
st.markdown("---")
st.markdown('<p class="sec-head">⚠️ Rebalancing Alerts — Stations Requiring Action</p>', unsafe_allow_html=True)

alerts = stations[stations["urgency"].isin(["Critical", "Warning"])].sort_values(
    ["urgency", "predicted_demand_1h"], ascending=[True, False]
).head(20)

col_a1, col_a2 = st.columns([2, 1], gap="medium")

with col_a1:
    # Table header
    st.markdown("""
    <div style="background:var(--card); border:1px solid var(--border); border-radius:12px;
                overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.05);">
      <div class="alert-row" style="background:#F8F9FD; border-bottom:2px solid var(--border);">
        <div class="alert-head">Station</div>
        <div class="alert-head">Alert</div>
        <div class="alert-head">Fill %</div>
        <div class="alert-head">Pred 1h</div>
        <div class="alert-head">Action</div>
      </div>
    """, unsafe_allow_html=True)

    for _, row in alerts.iterrows():
        badge = f'<span class="badge-critical">CRITICAL</span>' if row["urgency"] == "Critical" \
                else f'<span class="badge-warning">WARNING</span>'
        action_color = "var(--red)" if "ADD" in row["action"] else "var(--amber)" if "REMOVE" in row["action"] else "var(--green)"
        fill = int(row["fill_pct"] * 100)
        st.markdown(f"""
        <div class="alert-row">
          <div style="font-weight:500; font-size:0.82rem;">{row['name'][:45]}</div>
          <div>{badge}</div>
          <div style="font-family:var(--mono); font-size:0.8rem;">{fill}%</div>
          <div style="font-family:var(--mono); font-size:0.8rem; color:var(--blue);">{row['predicted_demand_1h']}</div>
          <div style="font-size:0.78rem; color:{action_color}; font-weight:500;">{row['action']}</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("</div>", unsafe_allow_html=True)

with col_a2:
    # Alert summary donut
    alert_counts = stations["urgency"].value_counts().reindex(["Critical", "Warning", "OK"]).fillna(0)
    fig_donut = go.Figure(go.Pie(
        values=alert_counts.values,
        labels=alert_counts.index,
        hole=0.62,
        marker=dict(colors=["#FF3B30", "#FF9F0A", "#34C759"],
                    line=dict(color="white", width=2)),
        textinfo="percent",
        textfont=dict(size=11, family="DM Mono"),
        hovertemplate="<b>%{label}</b>: %{value} stations<extra></extra>",
    ))
    fig_donut.add_annotation(
        text=f"<b>{int(alert_counts.get('Critical', 0)) + int(alert_counts.get('Warning', 0))}</b><br><span style='font-size:10px'>alerts</span>",
        x=0.5, y=0.5, showarrow=False,
        font=dict(size=18, family="Syne", color="#0A0E1A"),
        align="center"
    )
    fig_donut.update_layout(
        height=280,
        margin=dict(l=10, r=10, t=20, b=10),
        paper_bgcolor="rgba(0,0,0,0)",
        showlegend=True,
        legend=dict(orientation="h", y=-0.05, font=dict(size=11)),
        font=dict(family="DM Sans"),
        title=dict(text="Alert Distribution", font=dict(size=13, family="Syne"), x=0.5)
    )
    st.plotly_chart(fig_donut, use_container_width=True, config={"displayModeBar": False})


# ─── Footer ───────────────────────────────────────────────────────────────────
st.markdown("""
<div style="margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border);
            display:flex; justify-content:space-between; align-items:center;">
  <div style="font-family:var(--mono); font-size:0.65rem; color:var(--muted);">
    BlueForecast · MLOps Course Project · Northeastern University
  </div>
  <div style="font-family:var(--mono); font-size:0.65rem; color:var(--muted);">
    Data: Bluebikes S3 · GBFS API · Open-Meteo &nbsp;|&nbsp; Model: XGBoost · 8.2M rows × 32 features
  </div>
</div>
""", unsafe_allow_html=True)
