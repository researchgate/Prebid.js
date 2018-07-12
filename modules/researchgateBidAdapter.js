import { registerBidder } from 'src/adapters/bidderFactory';
import { BANNER, NATIVE, VIDEO } from 'src/mediaTypes';

const BIDDER_CODE = 'researchgate';

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER, VIDEO, NATIVE],
  
  isBidRequestValid: function(bid) {
    return window.pbjstest && window.pbjstest.isBidRequestValid;;
  },
  
  buildRequests: function(bidRequests, bidderRequest) {
    return window.pbjstest.buildRequests(bidRequests, bidderRequest);
  },

  interpretResponse: function(serverResponse, { bidderRequest }) {
    return window.pbjstest.interpretResponse(serverResponse, bidderRequest);
  },

  getUserSyncs: function(syncOptions) {
  },
};

registerBidder(spec);
