"""
ZEUS CSMS — Forecasting Engine
Modular forecasting dengan support:
- ARIMA (statsmodels)
- LS / Linear Regression (scikit-learn)
- SVR (scikit-learn)
- XGBoost (xgboost)
- ANN (tensorflow/keras)
- LSTM (tensorflow/keras)
"""

import logging
import numpy as np
from typing import List, Tuple, Dict, Any, Optional

logger = logging.getLogger("zeus.forecast")


# ════════════════════════════════════════════════════════════
#  DATA PREPARATION
# ════════════════════════════════════════════════════════════

def prepare_split(data: List[float], split_ratio: float) -> Tuple[List[float], List[float]]:
    """Split data menjadi train dan test berdasarkan ratio."""
    n_train = int(len(data) * split_ratio)
    return data[:n_train], data[n_train:]


def create_sequences(data: np.ndarray, look_back: int = 7) -> Tuple[np.ndarray, np.ndarray]:
    """Buat sequences X, y untuk model ML (SVR, ANN, LSTM, XGBoost)."""
    X, y = [], []
    for i in range(len(data) - look_back):
        X.append(data[i:i + look_back])
        y.append(data[i + look_back])
    return np.array(X), np.array(y)


def normalize(data: np.ndarray) -> Tuple[np.ndarray, float, float]:
    """Min-max normalization. Return (normalized, min, max)."""
    mn, mx = data.min(), data.max()
    if mx == mn:
        return np.zeros_like(data, dtype=float), mn, mx
    return (data - mn) / (mx - mn), mn, mx


def denormalize(data: np.ndarray, mn: float, mx: float) -> np.ndarray:
    return data * (mx - mn) + mn


# ════════════════════════════════════════════════════════════
#  METRICS
# ════════════════════════════════════════════════════════════

def compute_metrics(actual: np.ndarray, predicted: np.ndarray) -> Dict[str, float]:
    """Hitung MAPE, MAE, MSE, RMSE, R²."""
    actual    = np.array(actual,    dtype=float)
    predicted = np.array(predicted, dtype=float)

    mae  = float(np.mean(np.abs(actual - predicted)))
    mse  = float(np.mean((actual - predicted) ** 2))
    rmse = float(np.sqrt(mse))

    # MAPE — hindari division by zero
    mask = actual != 0
    mape = float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100) if mask.any() else 0.0

    # R²
    ss_res = np.sum((actual - predicted) ** 2)
    ss_tot = np.sum((actual - np.mean(actual)) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot != 0 else 0.0

    return {
        "mape": round(mape, 4),
        "mae":  round(mae,  4),
        "mse":  round(mse,  4),
        "rmse": round(rmse, 4),
        "r2":   round(r2,   4),
    }


# ════════════════════════════════════════════════════════════
#  MODEL REGISTRY — tambah model baru di sini
# ════════════════════════════════════════════════════════════

class ForecastResult:
    def __init__(self):
        self.train_actual:    List[float] = []
        self.train_predicted: List[float] = []
        self.test_actual:     List[float] = []
        self.test_predicted:  List[float] = []
        self.forecast:        List[float] = []
        self.metrics_train:   Dict[str, float] = {}
        self.metrics_test:    Dict[str, float] = {}
        self.model_name:      str = ""
        self.error:           Optional[str] = None


def run_model(
    method:       str,
    data:         List[float],
    split_ratio:  float,
    forecast_days: int,
    look_back:    int = 7,
) -> ForecastResult:
    """Jalankan model forecasting. Entry point utama."""
    result = ForecastResult()
    result.model_name = method.upper()

    try:
        train, test = prepare_split(data, split_ratio)

        if method == "arima":
            result = _run_arima(train, test, forecast_days, result)
        elif method == "ls":
            result = _run_ls(train, test, forecast_days, look_back, result)
        elif method == "svr":
            result = _run_svr(train, test, forecast_days, look_back, result)
        elif method == "xgboost":
            result = _run_xgboost(train, test, forecast_days, look_back, result)
        elif method == "ann":
            result = _run_ann(train, test, forecast_days, look_back, result)
        elif method == "lstm":
            result = _run_lstm(train, test, forecast_days, look_back, result)
        else:
            result.error = f"Metode tidak dikenal: {method}"
    except Exception as e:
        logger.error("Model %s error: %s", method, e)
        result.error = str(e)

    return result


# ════════════════════════════════════════════════════════════
#  ARIMA
# ════════════════════════════════════════════════════════════

def _run_arima(train, test, forecast_days, result):
    from statsmodels.tsa.arima.model import ARIMA
    import warnings
    warnings.filterwarnings("ignore")

    # Auto-select order
    best_aic = np.inf
    best_order = (1, 1, 1)
    for p in range(0, 3):
        for d in range(0, 2):
            for q in range(0, 3):
                try:
                    m = ARIMA(train, order=(p, d, q)).fit()
                    if m.aic < best_aic:
                        best_aic = m.aic
                        best_order = (p, d, q)
                except:
                    continue

    # Fit on train
    model = ARIMA(train, order=best_order).fit()

    # In-sample (train)
    train_pred = model.fittedvalues.tolist()
    result.train_actual    = list(train)
    result.train_predicted = [max(0, v) for v in train_pred]

    # Test prediction (walk-forward)
    history = list(train)
    test_pred = []
    for _ in range(len(test)):
        m = ARIMA(history, order=best_order).fit()
        pred = m.forecast(steps=1)[0]
        test_pred.append(max(0, float(pred)))
        history.append(test[len(test_pred) - 1] if len(test_pred) <= len(test) else pred)

    result.test_actual    = list(test)
    result.test_predicted = test_pred

    # Forecast
    full_model = ARIMA(list(train) + list(test), order=best_order).fit()
    fc = full_model.forecast(steps=forecast_days)
    result.forecast = [max(0, float(v)) for v in fc]

    result.metrics_train = compute_metrics(
        np.array(result.train_actual[-len(result.train_predicted):]),
        np.array(result.train_predicted)
    )
    result.metrics_test = compute_metrics(
        np.array(result.test_actual),
        np.array(result.test_predicted)
    )
    return result


# ════════════════════════════════════════════════════════════
#  LS — Linear Regression
# ════════════════════════════════════════════════════════════

def _run_ls(train, test, forecast_days, look_back, result):
    from sklearn.linear_model import LinearRegression

    train_arr = np.array(train)
    test_arr  = np.array(test)

    norm_data, mn, mx = normalize(np.concatenate([train_arr, test_arr]))
    n_train = len(train)
    norm_train = norm_data[:n_train]
    norm_test  = norm_data[n_train:]

    lb = min(look_back, len(norm_train) - 1)

    X_train, y_train = create_sequences(norm_train, lb)
    model = LinearRegression()
    model.fit(X_train, y_train)

    # Train metrics
    train_pred_norm = model.predict(X_train)
    result.train_actual    = list(denormalize(y_train, mn, mx))
    result.train_predicted = [max(0, v) for v in denormalize(train_pred_norm, mn, mx)]

    # Test prediction
    X_test, y_test = create_sequences(
        np.concatenate([norm_train[-lb:], norm_test]), lb)
    test_pred_norm = model.predict(X_test)
    result.test_actual    = list(denormalize(y_test, mn, mx))
    result.test_predicted = [max(0, v) for v in denormalize(test_pred_norm, mn, mx)]

    # Forecast
    last_seq = norm_data[-lb:]
    forecast = []
    for _ in range(forecast_days):
        pred = model.predict(last_seq.reshape(1, -1))[0]
        pred = float(np.clip(pred, 0, 1))
        forecast.append(max(0, float(denormalize(np.array([pred]), mn, mx)[0])))
        last_seq = np.append(last_seq[1:], pred)
    result.forecast = forecast

    result.metrics_train = compute_metrics(
        np.array(result.train_actual), np.array(result.train_predicted))
    result.metrics_test = compute_metrics(
        np.array(result.test_actual), np.array(result.test_predicted))
    return result


# ════════════════════════════════════════════════════════════
#  SVR
# ════════════════════════════════════════════════════════════

def _run_svr(train, test, forecast_days, look_back, result):
    from sklearn.svm import SVR

    train_arr = np.array(train)
    test_arr  = np.array(test)
    norm_data, mn, mx = normalize(np.concatenate([train_arr, test_arr]))
    n_train = len(train)
    norm_train = norm_data[:n_train]
    norm_test  = norm_data[n_train:]

    lb = min(look_back, len(norm_train) - 1)
    X_train, y_train = create_sequences(norm_train, lb)

    model = SVR(kernel="rbf", C=100, gamma=0.1, epsilon=0.01)
    model.fit(X_train, y_train)

    train_pred_norm = model.predict(X_train)
    result.train_actual    = list(denormalize(y_train, mn, mx))
    result.train_predicted = [max(0, v) for v in denormalize(train_pred_norm, mn, mx)]

    X_test, y_test = create_sequences(
        np.concatenate([norm_train[-lb:], norm_test]), lb)
    test_pred_norm = model.predict(X_test)
    result.test_actual    = list(denormalize(y_test, mn, mx))
    result.test_predicted = [max(0, v) for v in denormalize(test_pred_norm, mn, mx)]

    last_seq = norm_data[-lb:]
    forecast = []
    for _ in range(forecast_days):
        pred = float(model.predict(last_seq.reshape(1, -1))[0])
        pred = float(np.clip(pred, 0, 1))
        forecast.append(max(0, float(denormalize(np.array([pred]), mn, mx)[0])))
        last_seq = np.append(last_seq[1:], pred)
    result.forecast = forecast

    result.metrics_train = compute_metrics(
        np.array(result.train_actual), np.array(result.train_predicted))
    result.metrics_test = compute_metrics(
        np.array(result.test_actual), np.array(result.test_predicted))
    return result


# ════════════════════════════════════════════════════════════
#  XGBOOST
# ════════════════════════════════════════════════════════════

def _run_xgboost(train, test, forecast_days, look_back, result):
    import xgboost as xgb

    train_arr = np.array(train)
    test_arr  = np.array(test)
    norm_data, mn, mx = normalize(np.concatenate([train_arr, test_arr]))
    n_train = len(train)
    norm_train = norm_data[:n_train]
    norm_test  = norm_data[n_train:]

    lb = min(look_back, len(norm_train) - 1)
    X_train, y_train = create_sequences(norm_train, lb)

    model = xgb.XGBRegressor(
        n_estimators=100, max_depth=4, learning_rate=0.1,
        subsample=0.8, verbosity=0)
    model.fit(X_train, y_train)

    train_pred_norm = model.predict(X_train)
    result.train_actual    = list(denormalize(y_train, mn, mx))
    result.train_predicted = [max(0, v) for v in denormalize(train_pred_norm, mn, mx)]

    X_test, y_test = create_sequences(
        np.concatenate([norm_train[-lb:], norm_test]), lb)
    test_pred_norm = model.predict(X_test)
    result.test_actual    = list(denormalize(y_test, mn, mx))
    result.test_predicted = [max(0, v) for v in denormalize(test_pred_norm, mn, mx)]

    last_seq = norm_data[-lb:]
    forecast = []
    for _ in range(forecast_days):
        pred = float(model.predict(last_seq.reshape(1, -1))[0])
        pred = float(np.clip(pred, 0, 1))
        forecast.append(max(0, float(denormalize(np.array([pred]), mn, mx)[0])))
        last_seq = np.append(last_seq[1:], pred)
    result.forecast = forecast

    result.metrics_train = compute_metrics(
        np.array(result.train_actual), np.array(result.train_predicted))
    result.metrics_test = compute_metrics(
        np.array(result.test_actual), np.array(result.test_predicted))
    return result


# ════════════════════════════════════════════════════════════
#  ANN
# ════════════════════════════════════════════════════════════

def _run_ann(train, test, forecast_days, look_back, result):
    import os
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
    import tensorflow as tf
    tf.get_logger().setLevel("ERROR")
    from tensorflow import keras

    train_arr = np.array(train)
    test_arr  = np.array(test)
    norm_data, mn, mx = normalize(np.concatenate([train_arr, test_arr]))
    n_train = len(train)
    norm_train = norm_data[:n_train]
    norm_test  = norm_data[n_train:]

    lb = min(look_back, len(norm_train) - 1)
    X_train, y_train = create_sequences(norm_train, lb)

    model = keras.Sequential([
        keras.layers.Dense(64, activation="relu", input_shape=(lb,)),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(32, activation="relu"),
        keras.layers.Dense(1),
    ])
    model.compile(optimizer="adam", loss="mse")
    model.fit(X_train, y_train, epochs=50, batch_size=8, verbose=0)

    train_pred_norm = model.predict(X_train, verbose=0).flatten()
    result.train_actual    = list(denormalize(y_train, mn, mx))
    result.train_predicted = [max(0, v) for v in denormalize(train_pred_norm, mn, mx)]

    X_test, y_test = create_sequences(
        np.concatenate([norm_train[-lb:], norm_test]), lb)
    test_pred_norm = model.predict(X_test, verbose=0).flatten()
    result.test_actual    = list(denormalize(y_test, mn, mx))
    result.test_predicted = [max(0, v) for v in denormalize(test_pred_norm, mn, mx)]

    last_seq = norm_data[-lb:]
    forecast = []
    for _ in range(forecast_days):
        pred = float(model.predict(last_seq.reshape(1, -1), verbose=0)[0, 0])
        pred = float(np.clip(pred, 0, 1))
        forecast.append(max(0, float(denormalize(np.array([pred]), mn, mx)[0])))
        last_seq = np.append(last_seq[1:], pred)
    result.forecast = forecast

    result.metrics_train = compute_metrics(
        np.array(result.train_actual), np.array(result.train_predicted))
    result.metrics_test = compute_metrics(
        np.array(result.test_actual), np.array(result.test_predicted))
    return result


# ════════════════════════════════════════════════════════════
#  LSTM
# ════════════════════════════════════════════════════════════

def _run_lstm(train, test, forecast_days, look_back, result):
    import os
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
    import tensorflow as tf
    tf.get_logger().setLevel("ERROR")
    from tensorflow import keras

    train_arr = np.array(train)
    test_arr  = np.array(test)
    norm_data, mn, mx = normalize(np.concatenate([train_arr, test_arr]))
    n_train = len(train)
    norm_train = norm_data[:n_train]
    norm_test  = norm_data[n_train:]

    lb = min(look_back, len(norm_train) - 1)
    X_train, y_train = create_sequences(norm_train, lb)
    X_train_3d = X_train.reshape(X_train.shape[0], X_train.shape[1], 1)

    model = keras.Sequential([
        keras.layers.LSTM(64, return_sequences=True, input_shape=(lb, 1)),
        keras.layers.Dropout(0.2),
        keras.layers.LSTM(32),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(1),
    ])
    model.compile(optimizer="adam", loss="mse")
    model.fit(X_train_3d, y_train, epochs=50, batch_size=8, verbose=0)

    train_pred_norm = model.predict(X_train_3d, verbose=0).flatten()
    result.train_actual    = list(denormalize(y_train, mn, mx))
    result.train_predicted = [max(0, v) for v in denormalize(train_pred_norm, mn, mx)]

    X_test, y_test = create_sequences(
        np.concatenate([norm_train[-lb:], norm_test]), lb)
    X_test_3d = X_test.reshape(X_test.shape[0], X_test.shape[1], 1)
    test_pred_norm = model.predict(X_test_3d, verbose=0).flatten()
    result.test_actual    = list(denormalize(y_test, mn, mx))
    result.test_predicted = [max(0, v) for v in denormalize(test_pred_norm, mn, mx)]

    last_seq = norm_data[-lb:]
    forecast = []
    for _ in range(forecast_days):
        seq_3d = last_seq.reshape(1, lb, 1)
        pred = float(model.predict(seq_3d, verbose=0)[0, 0])
        pred = float(np.clip(pred, 0, 1))
        forecast.append(max(0, float(denormalize(np.array([pred]), mn, mx)[0])))
        last_seq = np.append(last_seq[1:], pred)
    result.forecast = forecast

    result.metrics_train = compute_metrics(
        np.array(result.train_actual), np.array(result.train_predicted))
    result.metrics_test = compute_metrics(
        np.array(result.test_actual), np.array(result.test_predicted))
    return result
