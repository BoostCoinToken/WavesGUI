(function () {
    'use strict';

    /**
     * @param $scope
     * @param $mdDialog
     * @param {AssetsService} assetsService
     * @param {Base} Base
     * @param {app.utils} utils
     * @param {app.utils.apiWorker} apiWorker
     * @param {User} user
     * @param {EventManager} eventManager
     * @param {@constructor PollComponent} PollComponent
     * @param {ModalManager} modalManager
     * @return {AssetSendCtrl}
     */
    const controller = function ($scope, $mdDialog, assetsService, Base, utils, apiWorker, user, eventManager, createPoll, modalManager) {

        class AssetSendCtrl extends Base {


            /**
             * @param {string} assetId
             * @param {string} mirrorId
             * @param {boolean} canChooseAsset
             */
            constructor(assetId, mirrorId, canChooseAsset) {
                super($scope);


                /**
                 * @type {BigNumber}
                 */
                this.amount = null;
                /**
                 * @type {BigNumber}
                 */
                this.amountMirror = null;

                this.observe('amount', this._onChangeAmount);
                this.observe('amountMirror', this._onChangeAmountMirror);
                this.observe('assetId', this._onChangeAssetId);

                this.step = 0;
                /**
                 * @type {boolean}
                 */
                this.canChooseAsset = !assetId || canChooseAsset;
                /**
                 * @type {string}
                 */
                this.mirrorId = mirrorId;
                /**
                 * @type {string}
                 */
                this.assetId = assetId || WavesApp.defaultAssets.WAVES;
                /**
                 * @type {string}
                 */
                this.recipient = '';
                /**
                 * @type {Money}
                 */
                this.feeData = null;
                /**
                 * @type {IAssetWithBalance}
                 */
                this.asset = null;
                /**
                 * @type {string}
                 */
                this.attachment = null;
                /**
                 * @type {IAssetWithBalance}
                 */
                this.mirror = null;
                /**
                 * @type {IAssetWithBalance[]}
                 */
                this.assetList = null;
                /**
                 * @type {boolean}
                 */
                this.noMirror = false;
                /**
                 * Id from created transaction
                 * @type {string}
                 * @private
                 */
                this._transactionId = null;

                if (this.canChooseAsset) {
                    createPoll(this, this._getBalanceList, this._setAssets, 1000, { isBalance: true });
                } else {
                    createPoll(this, this._getAsset, this._setAssets, 1000, { isBalance: true });
                }
            }

            send() {
                user.getSeed()
                    .then((data) => {
                        return apiWorker.process((WavesApi, data) => {
                            return WavesApi.API.Node.v1.assets.transfer({
                                assetId: data.assetId,
                                recipient: data.recipient,
                                amount: data.amount,
                                attachment: data.attachment
                            }, data.keyPair);
                        }, {
                            assetId: this.assetId,
                            recipient: this.recipient,
                            keyPair: data.keyPair,
                            attachment: this.attachment,
                            amount: new BigNumber(this.amount.toFixed(this.asset.precision))
                                .mul(Math.pow(10, this.asset.precision))
                                .toFixed(0)
                        });
                    })
                    .then((data) => {
                        this._transactionId = data.id;
                        eventManager.addEvent({
                            id: data.id,
                            components: [
                                { name: 'transfer' },
                                {
                                    name: 'balance',
                                    data: {
                                        amount: this.amount,
                                        assetId: this.assetId,
                                        precision: this.asset.precision
                                    }
                                },
                                {
                                    name: 'balance',
                                    data: {
                                        amount: this.feeData.getTokens(),
                                        assetId: this.feeData.asset.id,
                                        precision: this.feeData.asset.precision
                                    }
                                }
                            ]
                        });
                        this.step++;
                    });
            }

            showTransaction() {
                $mdDialog.hide();
                setTimeout(() => { // Timeout for routing (if modal has route)
                    modalManager.showTransactionInfo(this._transactionId);
                }, 1000);
            }

            fillMax() {
                if (this.assetId === this.feeData.asset.id) {
                    if (this.asset.balance.getTokens()
                            .gt(this.fee.getTokens())) {
                        this.amount = this.asset.balance.getTokens()
                            .sub(this.feeData.getTokens());
                    }
                } else {
                    this.amount = this.asset.balance.getTokens();
                }
            }

            cancel() {
                $mdDialog.cancel();
            }

            onReadQrCode(result) {
                this.recipient = result;
            }

            _getBalanceList() {
                return assetsService.getBalanceList().then((list) => {
                    return list && list.length ? list : assetsService.getBalanceList([WavesApp.defaultAssets.WAVES]);
                });
            }

            _onChangeAssetId() {
                if (!this.assetId) {
                    return null;
                }
                this.ready = utils.whenAll([
                    this.canChooseAsset ? this._getBalanceList() : assetsService.getBalance(this.assetId),
                    assetsService.getAssetInfo(this.mirrorId),
                    assetsService.getFeeSend(),
                    assetsService.getRate(this.assetId, this.mirrorId)
                ])
                    .then(([asset, mirror, feeData, api]) => {
                        this.noMirror = asset.id === mirror.id || api.rate.eq(0);
                        this.amount = new BigNumber(0);
                        this.amountMirror = new BigNumber(0);
                        this.mirror = mirror;
                        this.feeData = feeData;
                        this._setAssets(asset);
                        this.asset = tsUtils.find(this.assetList, { id: this.assetId });
                        this.fee = feeData;
                    });
            }

            /**
             * @return {Promise.<IAssetWithBalance>}
             * @private
             */
            _getAsset() {
                return assetsService.getBalance(this.assetId);
            }

            /**
             * @param {IAssetWithBalance|IAssetWithBalance[]} assets
             * @private
             */
            _setAssets(assets) {
                this.assetList = utils.toArray(assets);
                if (!this.assetId && this.assetList.length) {
                    this.assetId = this.assetList[0].id;
                }
            }

            /**
             * @private
             */
            _onChangeAmount() {
                this.amount && this.asset && this._getRate()
                    .then((api) => {
                        if (api.exchangeReverse(this.amountMirror)
                                .toFixed(this.asset.precision) !== this.amount.toFixed(this.asset.precision)) {
                            this.amountMirror = api.exchange(this.amount).round(this.mirror.precision);
                        }
                    });
            }

            /**
             * @private
             */
            _onChangeAmountMirror() {
                this.amountMirror && this.mirror && this._getRate()
                    .then((api) => {
                        if (api.exchange(this.amount)
                                .toFixed(this.mirror.precision) !== this.amountMirror.toFixed(this.mirror.precision)) {
                            this.amount = api.exchangeReverse(this.amountMirror).round(this.asset.precision);
                        }
                    });
            }

            _isValid() {
                if (!this.amount) {
                    return false;
                }
                return this.amount.lt(this.asset.id === this.feeData.asset.id ?
                    this.asset.balance.getTokens().add(this.feeData.getTokens()) : this.asset.balance.getTokens());
            }

            /**
             * @param {string} [fromRateId]
             * @return {Promise.<AssetsService.rateApi>}
             * @private
             */
            _getRate(fromRateId) {
                return assetsService.getRate(fromRateId || this.assetId, this.mirrorId);
            }

        }

        return new AssetSendCtrl(this.assetId, this.baseAssetId, this.canChooseAsset);
    };

    controller.$inject = [
        '$scope',
        '$mdDialog',
        'assetsService',
        'Base',
        'utils',
        'apiWorker',
        'user',
        'eventManager',
        'createPoll',
        'modalManager'
    ];

    angular.module('app.utils')
        .controller('AssetSendCtrl', controller);
})();