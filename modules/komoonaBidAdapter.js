<<<<<<< HEAD:src/adapters/komoona.js
var utils = require('../utils.js');
var bidfactory = require('../bidfactory.js');
var bidmanager = require('../bidmanager.js');
var adloader = require('../adloader');
var STATUS = require('../constants').STATUS;
//Adapter version: 0.81

var KomoonaAdapter = function KomoonaAdapter() {
  var KOMOONA_BIDDER_NAME = 'komoona';

  function _callBids(params) {
    var kbConf = {
      ts_as: new Date().getTime(),
      hb_placements: [],
      hb_placement_bidids: {},
      kb_callback: _bid_arrived,
      hb_floors: {}
    };

    var bids = params.bids || [];
    if (!bids || !bids.length) {
=======
import Adapter from 'src/adapter';
import bidfactory from 'src/bidfactory';
import bidmanager from 'src/bidmanager';
import * as utils from 'src/utils';
import { ajax } from 'src/ajax';
import { STATUS } from 'src/constants';
import adaptermanager from 'src/adaptermanager';

const ENDPOINT = '//bidder.komoona.com/v1/GetSBids';

function KomoonaAdapter() {
  let baseAdapter = Adapter.createNew('komoona');
  let bidRequests = {};

  /* Prebid executes this function when the page asks to send out bid requests */
  baseAdapter.callBids = function(bidRequest) {
    const bids = bidRequest.bids || [];
    const tags = bids
      .filter(bid => valid(bid))
      .map(bid => {
        // map request id to bid object to retrieve adUnit code in callback
        bidRequests[bid.bidId] = bid;

        let tag = {};
        tag.sizes = bid.sizes;
        tag.uuid = bid.bidId;
        tag.placementid = bid.params.placementId;
        tag.hbid = bid.params.hbid;

        return tag;
      });

    if (!utils.isEmpty(tags)) {
      const payload = JSON.stringify({bids: [...tags]});

      ajax(ENDPOINT, handleResponse, payload, {
        contentType: 'text/plain',
        withCredentials: true
      });
    }
  };

  /* Notify Prebid of bid responses so bids can get in the auction */
  function handleResponse(response) {
    let parsed;

    try {
      parsed = JSON.parse(response);
    } catch (error) {
      utils.logError(error);
    }

    if (!parsed || parsed.error) {
      let errorMessage = `in response for ${baseAdapter.getBidderCode()} adapter`;
      if (parsed && parsed.error) { errorMessage += `: ${parsed.error}`; }
      utils.logError(errorMessage);

      // signal this response is complete
      Object.keys(bidRequests)
        .map(bidId => bidRequests[bidId].placementCode)
        .forEach(placementCode => {
          bidmanager.addBidResponse(placementCode, createBid(STATUS.NO_BID));
        });

>>>>>>> upstream/master:modules/komoonaBidAdapter.js
      return;
    }

    bids.forEach((currentBid) => {
      kbConf.hdbdid = kbConf.hdbdid || currentBid.params.hbid;
      kbConf.encode_bid = kbConf.encode_bid || currentBid.params.encode_bid;
      kbConf.hb_placement_bidids[currentBid.params.placementId] = currentBid.bidId;
      if (currentBid.params.floorPrice) {
        kbConf.hb_floors[currentBid.params.placementId] = currentBid.params.floorPrice;
      }
      kbConf.hb_placements.push(currentBid.params.placementId);      
    });

    var scriptUrl = `//s.komoona.com/kb/0.1/kmn_sa_kb_c.${kbConf.hdbdid}.js`;

    adloader.loadScript(scriptUrl, function() {
      /*global KmnKB */
      if (typeof KmnKB === 'function') {
        KmnKB.start(kbConf);
      }
    }, true);
  }

  function _bid_arrived(bid) {
    var bidObj = utils.getBidRequest(bid.bidid);
    var bidStatus = bid.creative ? STATUS.GOOD : STATUS.NO_BID;
    var bidResponse = bidfactory.createBid(bidStatus, bidObj);
    bidResponse.bidderCode = KOMOONA_BIDDER_NAME;

    if (bidStatus === STATUS.GOOD) {
      bidResponse.ad = bid.creative;
      bidResponse.cpm = bid.cpm;
      bidResponse.width = parseInt(bid.width);
      bidResponse.height = parseInt(bid.height);
    }

    var placementCode = bidObj && bidObj.placementCode;
    bidmanager.addBidResponse(placementCode, bidResponse);
  }

  // Export the callBids function, so that prebid.js can execute this function
  // when the page asks to send out bid requests.
  return {
    callBids: _callBids,
  };
};

adaptermanager.registerBidAdapter(new KomoonaAdapter, 'komoona');

module.exports = KomoonaAdapter;
