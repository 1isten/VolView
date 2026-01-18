if (typeof window.dcmjs !== undefined) {
  window.dcmjs.$utils = {
    getTagsFromDicomDict(DicomDict = {}, nested = true, parent) {
      const tags = [];

      const data = {
        ...(DicomDict.meta || {}),
        ...(DicomDict.dict || {}),
      };

      Object.keys(data).sort((a, b) => a.localeCompare(b)).forEach(tag => {
        const punctuatedTag = dcmjs.data.DicomMetaDictionary.punctuateTag(tag);
        const entry = dcmjs.data.DicomMetaDictionary.dictionary[punctuatedTag];
        const naturalName = entry ? entry.name : punctuatedTag;
        const { Value, vr, InlineBinary, BulkDataURI } = data[tag];

        const item = {
          _path: [...(parent && parent._path || []), punctuatedTag],
          tag: punctuatedTag,
          name: naturalName,
          vr,
          Value,
        };
        if (nested) {
          delete item._path;
        }
        let shouldPush = true;

        if (item.Value === undefined) {
          if (InlineBinary) {
            item.Value = InlineBinary;
          } else if (BulkDataURI) {
            item.Value = BulkDataURI;
          }
        }
        if (vr === 'SQ' && Array.isArray(item.Value)) {
          if (nested) {
            item.children = [];
          } else {
            tags.push({ ...item, Value: '' });
            shouldPush = false;
          }
          item.Value.forEach((childItem, i) => {
            const itemDelimitationTag = '(FFFE,E000)' + ` #${i + 1}`;
            const itemDelimitationItem = {
              _path: [...(item._path || []), itemDelimitationTag],
              tag: itemDelimitationTag,
              name: 'Item',
              vr: '',
              Value: '',
            };
            const children = this.getTagsFromDicomDict({ dict: childItem }, nested, itemDelimitationItem);
            if (nested) {
              delete itemDelimitationItem._path;
              itemDelimitationItem.children = children;
              item.children.push(itemDelimitationItem);
            } else {
              tags.push(itemDelimitationItem, ...children);
            }
          });
          item.Value = '';
        } else if (vr ==='OW' || vr ==='OB' || vr ==='OF' || vr ==='UN' || vr ==='UT') {
          item.Value = '';
        } else if (item.Value.__hasValueAccessors) {
          item.Value = item.Value.toString();
        } else if (item.Value.length === 1) {
          item.Value = item.Value[0];
        } else if (item.Value.length) {
          item.Value = item.Value.join(String.fromCharCode(0x5c)); // '\\'
        }
        if (shouldPush) {
          tags.push(item);
        }
      });

      return tags;
    },

    // ...
  };
}
