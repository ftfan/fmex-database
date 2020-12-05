import BigNumber from 'bignumber.js';

const DataParseFun: any = {
  parse1(data: any, params: any) {
    return data.map((item: any) => {
      const revert: any = {};
      item.forEach((val: any, index: any) => {
        const p = params[index];
        if (p.Add) val = val + p.Add;
        revert[p.Key] = val;
      });
      return revert;
    });
  },
};

export const DataParse = (data: any) => {
  if (!data) return data;
  if (!data.DataParse) return data;
  const fun = DataParseFun[data.DataParse];
  if (!fun) return data;
  return fun(data.Data, data.Params);
};
export const SysName = (name: string) => {
  switch (name) {
    case 'Futures Insurance Fund':
      return '合约保险基金';
    case 'Fee income':
    case 'Contract Fee income':
      return '合约手续费收入';
    case 'Spot Fee income':
      return '现货手续费收入';
    case 'Account with Unrealised PNL':
      return '合约未实现盈亏账户';
    case 'xxxxxdsadsadsad':
      return 'FUSD解锁账户';
    case 'Hot wallet collection address':
      return '热钱包归集地址';
    case 'Community multiple-signature address':
      return '社区多签地址';
    default:
      return name;
  }
};
export const NumParse = (str: string) => {
  if (!str) return 0;
  const NumParse = (n: string) => {
    n = n.replace('k', '000');
    n = n.replace('w', '0000');
    return parseFloat(n);
  };
  // xx+
  if (str.indexOf('+') > -1) return NumParse(str.replace('+', ''));
  return NumParse(str);
};
export const ParamsNumParse = (str: string) => {
  return str.split('~').map(NumParse);
};

/**
 * 因为历史原因，单个标签，有多个语言和注释。
 * 这里过滤
 */
export const PageConfigHackFilter = (PageConfig: any, index = 0): any => {
  if (index >= PageConfig.Params.length) return;
  const item = PageConfig.Params[index];
  if (index < 16) return PageConfigHackFilter(PageConfig, ++index); // 前面固定Key，非标签数据
  const name = SysName(item.Key);
  if (name === item.Key) return PageConfigHackFilter(PageConfig, ++index); // 标签一致
  const real = PageConfig.Params.filter((item: any) => item.Key === name)[0];
  const realIndex = PageConfig.Params.indexOf(real);
  if (realIndex === -1) return PageConfigHackFilter(PageConfig, ++index);

  // merge
  PageConfig.Data.forEach((data: any) => {
    const val = data[index];
    while (data.length <= index) return; // 当前数据上不存在 该标签
    while (data.length <= realIndex) data.push(null);
    const old = data[realIndex];
    data[realIndex] = isNaN(val) ? old : old || val; // 如果数据为null。直接用旧数据，尽管旧数据也会是null

    data.splice(index, 1);
  });
  // delete
  PageConfig.Params.splice(index, 1);
  return PageConfigHackFilter(PageConfig, index);
};

export const PageDataPush = (PageConfig: any, data: any) => {
  const line = PageConfig.Params.map(() => NaN);
  line[0] = PageConfig.EndTime; // X轴，时间
  data.forEach((item: any) => {
    item.amount = new BigNumber(item.amount);
    item.label = SysName(item.label);
  });
  // 从大到小
  data.sort((a: any, b: any) => b.amount.minus(a.amount).toNumber());
  const Total = [
    ParamsNumParse(PageConfig.Params[1].Key),
    ParamsNumParse(PageConfig.Params[2].Key),
    ParamsNumParse(PageConfig.Params[3].Key),
    [ParamsNumParse(PageConfig.Params[4].Key)[0], Infinity],
    [0, Infinity],
  ];
  const TotalAccount = [
    ParamsNumParse(PageConfig.Params[6].Key),
    ParamsNumParse(PageConfig.Params[7].Key),
    ParamsNumParse(PageConfig.Params[8].Key),
    [ParamsNumParse(PageConfig.Params[9].Key)[0], Infinity],
    [0, Infinity],
  ];

  data.forEach((item: any, index: number) => {
    const amount = item.amount.toNumber();
    // 前5名
    if (index < 5) {
      const PIndex = index + 11;
      line[PIndex] = amount;
    }

    Total.forEach(([num1, num2], i) => {
      const ri = i + 1;
      if (isNaN(line[ri])) line[ri] = new BigNumber(0); // 初始为0
      if (amount >= num1 && amount < num2) line[ri] = line[ri].plus(item.amount);
    });
    TotalAccount.forEach(([num1, num2], i) => {
      const ri = i + 6;
      if (isNaN(line[ri])) line[ri] = 0; // 初始为0
      if (amount >= num1 && amount < num2) line[ri]++;
    });

    // 如果该资产有标签，需要对标签进行添加
    if (item.label) {
      let has = PageConfig.Params.filter((p: any) => p.Key === item.label)[0];
      if (!has) {
        has = { Key: item.label };
        PageConfig.Params.push(has);
        line.push(NaN);
      }
      const iii = PageConfig.Params.indexOf(has);
      line[iii] = amount;
    }
  });
  Total.forEach(([num1, num2], i) => {
    const ri = i + 1;
    if (!isNaN(line[ri])) line[ri] = line[ri].toNumber();
  });

  // console.log(PageConfig.EndTime, line, data);
  PageConfig.Data.push(line);
};

// "snapshot_time": 1598716800000,
// "platform_total_amount": "174227.62457400",
// "user_total_amount": "167386.43236869",
// "assets_rate": "1.04",
// "platform_wallet_assets": [

export const PageDataPush2 = (PageConfig: any, data: any) => {
  const line = PageConfig.Params.map(() => NaN);
  line[0] = data.snapshot_time; // X轴，时间
  line[1] = data.platform_total_amount;
  line[2] = data.user_total_amount;
  line[3] = data.assets_rate;

  data.platform_wallet_assets.forEach((item: any, index: number) => {
    item.address_label = SysName(item.address_label);
    // const amount = parseFloat(item.amount);

    let has = PageConfig.Params.filter((p: any) => p.Key === item.address)[0];
    if (!has) {
      has = { Key: item.address, address_label: item.address_label };
      PageConfig.Params.push(has);
      line.push(NaN);
    } else {
      has.address_label = item.address_label; // 更新标签，避免有变更
    }
    const iii = PageConfig.Params.indexOf(has);
    line[iii] = item.amount;
  });

  // console.log(PageConfig.EndTime, line, data);
  PageConfig.Data.push(line);
};

// Currency,
// kline: {},
// platform_total_amount: '',
// user_total_amount: ''
export const PageDataPush3 = (PageConfig: any, data: any) => {
  const line = PageConfig.Params.map(() => NaN);
  line[0] = data.snapshot_time; // X轴，时间
  line[1] = data.platform_total_amount;
  line[2] = data.user_total_amount;
  line[3] = data.kline.quote_vol;
  line[4] = data.kline.base_vol;
  const price = new BigNumber(data.kline.quote_vol).div(data.kline.base_vol);
  line[5] = price.multipliedBy(data.platform_total_amount).toString();
  line[6] = price.multipliedBy(data.user_total_amount).toString();

  PageConfig.Data.push(line);
};

// 过滤掉重复数据
export const DataFilterSame = (data: any[]) => {
  const hashmap: { [index: string]: string } = {};
  const dels: any[] = [];
  data.forEach((item) => {
    if (hashmap[item.hash]) dels.push(item);
    hashmap[item.hash] = item;
  });
  dels.forEach((item) => {
    data.splice(data.indexOf(item), 1);
  });
};
