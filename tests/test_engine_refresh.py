"""Regression tests against the official Get Event and candlestick schemas."""
import unittest
from unittest.mock import patch

from tools import engine_refresh as refresh


class EngineRefreshTests(unittest.TestCase):
    def test_event_lookup_and_cache(self):
        events = {}
        with patch.object(refresh, 'get_json', return_value=(
            {'event': {'series_ticker': 'KXBTC'}}, 'https://example.test/event', None
        )) as fetch:
            self.assertEqual(refresh.event_series('KXBTC-EVENT', events, refresh.BASE),
                             ('KXBTC', 'https://example.test/event', None))
            self.assertEqual(refresh.event_series('KXBTC-EVENT', events, refresh.BASE)[0], 'KXBTC')
            fetch.assert_called_once()
            self.assertEqual(fetch.call_args.args[0], '/events/KXBTC-EVENT')

    def test_missing_series_is_not_inferred(self):
        events = {'KXBTC-EVENT': {'source': 'official'}}
        self.assertEqual(refresh.event_series('KXBTC-EVENT', events, refresh.BASE),
                         (None, 'official', 'event has no series_ticker'))
        self.assertEqual(refresh.event_series(None, events, refresh.BASE)[0], None)
        with patch.object(refresh, 'get_json', return_value=(None, 'official', 'HTTP 503')):
            self.assertEqual(refresh.event_series('E', {}, refresh.BASE), (None, 'official', 'HTTP 503'))

    def test_nested_candlestick_fields_and_nulls(self):
        result = refresh.candle_point({'end_period_ts': 123, 'price': {
            'open_dollars': '0.1200', 'close_dollars': '0.2300',
            'high_dollars': '0.2500', 'low_dollars': '0.1100'},
            'yes_bid': {'close_dollars': '0.2200'},
            'yes_ask': {'close_dollars': '0.2400'}, 'volume_fp': '10.00'})
        self.assertEqual(result, {'t': 123, 'price_open': .12, 'price_close': .23,
                                  'price_high': .25, 'price_low': .11,
                                  'yes_bid_close': .22, 'yes_ask_close': .24, 'volume': 10.0})
        self.assertIsNone(refresh.candle_point({'price': None})['price_close'])


if __name__ == '__main__':
    unittest.main()
