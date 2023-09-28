import {
  base64ToHex,
  getTwoItemPosition,
  hexToTwoItems,
  parseError,
  sleep,
  hexToDecimal,
  farToCen
} from '../utils/functions.js';
import platformLang from '../utils/lang-en.js';

/*
  Custom Mode:                                 aa050001010000000000000000000000000000af

  Green Tea:      MwUAAgAAAAAAAAAAAAAAAAAAADQ= 3305000200000000000000000000000000000034 [switch]
                  MwEBAgAAAAAAAAAAAAAAAAAAADk= 3301010200000000000000000000000000000039 [enable]

  Oolong Tea:     MwUAAwAAAAAAAAAAAAAAAAAAADU= 3305000300000000000000000000000000000035 [switch]
                  MwEBAwAAAAAAAAAAAAAAAAAAADg= 3301010300000000000000000000000000000038 [enable]

  Coffee:         MwUABAAAAAAAAAAAAAAAAAAAADI= 3305000400000000000000000000000000000032 [switch]
                  MwEBBAAAAAAAAAAAAAAAAAAAADc= 3301010400000000000000000000000000000037 [enable]

  Black Tea/Boil: MwUABQAAAAAAAAAAAAAAAAAAADM= 3305000500000000000000000000000000000033 [switch]
                  MwEBBQAAAAAAAAAAAAAAAAAAADY= 3301010500000000000000000000000000000036 [enable]
 */
export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic;
    this.hapErr = platform.api.hap.HapStatusError;
    this.hapServ = platform.api.hap.Service;
    this.platform = platform;

    // Set up variables from the accessory
    this.accessory = accessory;
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId] || {};

    // Set up cached values
    this.cacheMode;
    this.cachePowerOn;

    const codes = {
      greenTea: 'MwUAAgAAAAAAAAAAAAAAAAAAADQ=',
      oolongTea: 'MwUAAwAAAAAAAAAAAAAAAAAAADU=',
      coffee: 'MwUABAAAAAAAAAAAAAAAAAAAADI=',
      blackTea: 'MwUABQAAAAAAAAAAAAAAAAAAADM=',
      customMode1: 'MwUAAQEAAAAAAAAAAAAAAAAAADY=',
      customMode2: 'MwUAAQIAAAAAAAAAAAAAAAAAADU=',
    };

    // Add a switch service for Green Tea
    this.greenTeaService = this.initService(1, 'Green Tea', 'greenTea', deviceConf.hideModeGreenTea, codes.greenTea);

    // Add a switch service for Oolong Tea
    this.oolongTeaService = this.initService(2, 'Oolong Tea', 'oolongTea', deviceConf.hideModeOolongTea, codes.oolongTea);

    // Add a switch service for Coffee
    this.coffeeService = this.initService(3, 'Coffee', 'coffee', deviceConf.hideModeCoffee, codes.coffee);

    // Add a switch service for Black Tea/Boil
    this.blackTeaBoilService = this.initService(4, 'Black Tea/Boil', 'blackTeaBoil', deviceConf.hideModeBlackTeaBoil, codes.blackTea);

    // Add a switch service for Custom Mode 1
    this.customMode1Service = this.initService(5, 'Custom Mode 1', 'customMode1', !deviceConf.showCustomMode1, codes.customMode1);

    // Add a switch service for Custom Mode 2
    this.customMode2Service = this.initService(6, 'Custom Mode 2', 'customMode2', !deviceConf.showCustomMode2, codes.customMode2);

    // Add a service for the current temperature
    this.temperatureService = this.accessory.getService(this.hapServ.TemperatureSensor);
    if (deviceConf.hideTemperature) {
      if (this.temperatureService) {
        this.accessory.removeService(this.hapServ.TemperatureSensor);
      }
    } else if (!this.temperatureService) {
      this.temperatureService = this.accessory.addService(this.hapServ.TemperatureSensor);
      this.temperatureService.addCharacteristic(this.hapChar.ConfiguredName);
      this.temperatureService.updateCharacteristic(this.hapChar.ConfiguredName, 'Temperature');
      this.temperatureService.addCharacteristic(this.hapChar.ServiceLabelIndex);
      this.temperatureService.updateCharacteristic(this.hapChar.ServiceLabelIndex, 7);
    }

    // Output the customised options to the log
    const opts = JSON.stringify({});
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts);
  }

  initService(index, name, id, shouldHide, b64Code) {
    let service = this.accessory.getService(name);
    if (shouldHide) {
      if (service) {
        this.accessory.removeService(service);
      }
    } else if (!service) {
      service = this.accessory.addService(this.hapServ.Switch, name, id);
      service.addCharacteristic(this.hapChar.ConfiguredName);
      service.updateCharacteristic(this.hapChar.ConfiguredName, name);
      service.addCharacteristic(this.hapChar.ServiceLabelIndex);
      service.updateCharacteristic(this.hapChar.ServiceLabelIndex, index);
    }

    if (service) {
      service.getCharacteristic(this.hapChar.On)
          .updateValue(false)
          .onSet(async (value) => this.internalStateUpdate(service, value, b64Code));
    }

    return service;
  }

  async internalStateUpdate(service, value, b64Code) {
    try {
      if (!value) {
        // Send the request to the platform sender function to turn off boiling mode
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
        });
        this.cachePowerOn = false;
        return;
      }

      // Send the request to the platform sender function to change the mode
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: b64Code,
      });

      await sleep(1000);

      // Send the request to the platform sender function to turn to boiling mode
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: 'MwEBAAAAAAAAAAAAAAAAAAAAADM=',
      });

      // Cache the new state and log if appropriate
      this.cachePowerOn = true;
      this.accessory.log(`${platformLang.curMode} [${service.displayName}]`);
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`);

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        service.updateCharacteristic(this.hapChar.On, false);
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  externalUpdate(params) {
    // Check for some other scene/mode change
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command);
      const hexParts = hexToTwoItems(hexString);

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return;
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`;

      let changed = false;

      switch (deviceFunction) {
        case '0500': { // current mode
          const currentModeCode = `${getTwoItemPosition(hexParts, 4)}${getTwoItemPosition(hexParts, 5)}`;
          if (currentModeCode !== this.cacheMode) {
            this.cacheMode = currentModeCode;
            changed = true;
          }
          this.accessory.log(`current mode code [${currentModeCode}]`);
          break;
        }
        case '1001': { // current temperature in F
          const currentTempInF = hexToDecimal(`${getTwoItemPosition(hexParts, 4)}${getTwoItemPosition(hexParts, 5)}`) / 100;
          this.accessory.log(`current temp [${currentTempInF} F]`);
          this.temperatureService.setCharacteristic(this.hapChar.CurrentTemperature, farToCen(currentTempInF));
          break;
        }
        case '1900': { // kettle off
          this.accessory.log(`current switched on [off]`);
          if (this.cachePowerOn) {
            this.cachePowerOn = false;
            changed = true;
          }
          break;
        }
        case '1901': { // kettle on
          this.accessory.log(`current switched on [on]`);
          if (!this.cachePowerOn) {
            this.cachePowerOn = true;
            changed = true;
          }
          break;
        }
        case '1700': // on/off base?
        case '2200': // keep warm off
        case '2201': // keep warm on
        case '2300': // scheduled start off
        case '2301': { // scheduled start on
          break;
        }
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`);
          break;
      }

      if (changed) {
        const serviceMap = {
          '0200': this.greenTeaService,
          '0300': this.oolongTeaService,
          '0400': this.coffeeService,
          '0500': this.blackTeaBoilService,
          '0101': this.customMode1Service,
          '0102': this.customMode2Service
        };
        for (const code in serviceMap) {
          if (serviceMap[code]) {
            serviceMap[code].updateCharacteristic(this.hapChar.On, !!(this.cachePowerOn && code === this.cacheMode));
          }
        }
      }
    });
  }
}
