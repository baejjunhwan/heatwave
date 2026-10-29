"""EPSG:5179 (Korea 2000 / Unified CS) transverse Mercator, GRS80 — forward and inverse (Snyder 1987)."""
import numpy as np

A = 6378137.0
F = 1 / 298.257222101
E2 = F * (2 - F)
EP2 = E2 / (1 - E2)
LAT0, LON0, K0, FE, FN = np.radians(38.0), np.radians(127.5), 0.9996, 1_000_000.0, 2_000_000.0


def _M(phi):
    e2, e4, e6 = E2, E2**2, E2**3
    return A * ((1 - e2/4 - 3*e4/64 - 5*e6/256) * phi
                - (3*e2/8 + 3*e4/32 + 45*e6/1024) * np.sin(2*phi)
                + (15*e4/256 + 45*e6/1024) * np.sin(4*phi)
                - (35*e6/3072) * np.sin(6*phi))


M0 = _M(LAT0)


def forward(lon, lat):
    phi, lam = np.radians(lat), np.radians(lon)
    N = A / np.sqrt(1 - E2*np.sin(phi)**2)
    T = np.tan(phi)**2
    C = EP2*np.cos(phi)**2
    Aa = (lam - LON0)*np.cos(phi)
    M = _M(phi)
    x = FE + K0*N*(Aa + (1-T+C)*Aa**3/6 + (5-18*T+T**2+72*C-58*EP2)*Aa**5/120)
    y = FN + K0*(M - M0 + N*np.tan(phi)*(Aa**2/2 + (5-T+9*C+4*C**2)*Aa**4/24
                                         + (61-58*T+T**2+600*C-330*EP2)*Aa**6/720))
    return x, y


def inverse(x, y):
    M = M0 + (y - FN)/K0
    mu = M/(A*(1 - E2/4 - 3*E2**2/64 - 5*E2**3/256))
    e1 = (1 - np.sqrt(1-E2))/(1 + np.sqrt(1-E2))
    phi1 = (mu + (3*e1/2 - 27*e1**3/32)*np.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32)*np.sin(4*mu)
            + (151*e1**3/96)*np.sin(6*mu) + (1097*e1**4/512)*np.sin(8*mu))
    C1 = EP2*np.cos(phi1)**2
    T1 = np.tan(phi1)**2
    N1 = A/np.sqrt(1 - E2*np.sin(phi1)**2)
    R1 = A*(1-E2)/(1 - E2*np.sin(phi1)**2)**1.5
    D = (x - FE)/(N1*K0)
    phi = phi1 - (N1*np.tan(phi1)/R1)*(D**2/2 - (5+3*T1+10*C1-4*C1**2-9*EP2)*D**4/24
                                       + (61+90*T1+298*C1+45*T1**2-252*EP2-3*C1**2)*D**6/720)
    lam = LON0 + (D - (1+2*T1+C1)*D**3/6 + (5-2*C1+28*T1-3*C1**2+8*EP2+24*T1**2)*D**5/120)/np.cos(phi1)
    return np.degrees(lam), np.degrees(phi)


if __name__ == '__main__':
    lon, lat = np.array([126.85, 126.92, 127.02]), np.array([35.13, 35.18, 35.25])
    x, y = forward(lon, lat)
    lo2, la2 = inverse(x, y)
    print(x, y)
    print('roundtrip err (deg)', np.abs(lo2-lon).max(), np.abs(la2-lat).max())
